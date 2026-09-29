<?php
require_once __DIR__ . '/db.php';

/** A refusal with its HTTP status and JSON body, turned into the response by runApi(). */
final class ApiFailure extends RuntimeException {
    public $status;
    public $body;

    public function __construct(int $status, array $body) {
        parent::__construct($body['error'] ?? 'failure');
        $this->status = $status;
        $this->body = $body;
    }
}

/** Sends JSON that no cache may keep, then ends the request. */
function respond(int $status, $body): void {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    exit(json_encode($body));
}

function failWith(int $status, string $error, array $extra = []): void {
    throw new ApiFailure($status, ['error' => $error] + $extra);
}

/**
 * Decodes the request body as a JSON object, reading at most 256 KiB.
 *
 * @return array The decoded object, or an empty array for anything else, so
 *               every field check downstream fails closed.
 */
function readJsonBody(): array {
    $raw = file_get_contents('php://input', false, null, 0, 262144);
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Accepts a positive integer or its decimal string of at most 19 digits.
 *
 * @return int|null The identifier, or null for zero, negatives, signs, spaces,
 *                  floats and anything longer.
 */
function positiveId($value): ?int {
    if (is_int($value) && $value > 0) return $value;
    if (is_string($value) && preg_match('/^[1-9][0-9]{0,18}$/', $value)) return (int)$value;
    return null;
}

/** A page size clamped to 1 to 100; the default applies only when no integer was given. */
function boundedLimit($value, int $default = 50): int {
    if (is_int($value) || (is_string($value) && preg_match('/^-?[0-9]{1,9}$/', $value))) {
        return max(1, min(100, (int)$value));
    }
    return $default;
}

/**
 * Runs one chat mutation under the feed lock and records what it changed.
 *
 * The named lock serialises every writer, so event IDs are committed in the
 * order they were allocated and a reader that saw event N never later meets an
 * uncommitted event below N. Inside the lock the work runs in a transaction and
 * one message_events row is written per changed message; a write made outside
 * this function never reaches the other identity's feed. See GET_LOCK():
 * https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html
 *
 * @param callable $work Receives the connection and returns
 *                       ['changed' => int[] message IDs, 'value' => mixed].
 * @return mixed The work's 'value'.
 * @throws ApiFailure 503 'busy' when the lock is not granted within 10 seconds.
 * @throws Throwable  Whatever the work throws, after the transaction is rolled
 *                    back; the lock is released on every path.
 */
function withFeedLock(PDO $db, callable $work) {
    // Lock names are server-wide and limited to 64 characters; the database name
    // keeps two installations on one server from blocking each other.
    $name = substr('mirage_feed_' . DB_NAME, 0, 64);
    $lock = $db->prepare('SELECT GET_LOCK(?, 10)');
    $lock->execute([$name]);
    if ((int)$lock->fetchColumn() !== 1) {
        failWith(503, 'busy');
    }
    try {
        $db->beginTransaction();
        $outcome = $work($db);
        $changed = array_values(array_unique(array_map('intval', $outcome['changed'] ?? [])));
        $event = $db->prepare('INSERT INTO message_events (message_id) VALUES (?)');
        foreach ($changed as $messageId) {
            $event->execute([$messageId]);
        }
        $db->commit();
        return $outcome['value'] ?? null;
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    } finally {
        $db->prepare('SELECT RELEASE_LOCK(?)')->execute([$name]);
    }
}

/** The newest event ID, or 0 before the first change: a reader polls from here. */
function feedCursor(PDO $db): int {
    return (int)$db->query('SELECT COALESCE(MAX(id), 0) FROM message_events')->fetchColumn();
}

function touchPresence(PDO $db, string $identity): void {
    $db->prepare('INSERT INTO user_presence (identity, last_seen) VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE last_seen = UTC_TIMESTAMP()')
       ->execute([$identity]);
}

/**
 * When the other identity last polled, measured by the database clock.
 *
 * The age is computed on the server so a wrong clock on either device cannot
 * make the other person look present or absent.
 *
 * @return array other_last_seen (ISO 8601 UTC) and other_age_seconds, both null
 *               until the other identity has polled once.
 */
function otherPresence(PDO $db, string $identity): array {
    $other = $identity === 'user-a' ? 'user-b' : 'user-a';
    $stmt = $db->prepare('SELECT last_seen, GREATEST(0, TIMESTAMPDIFF(SECOND, last_seen, UTC_TIMESTAMP())) AS age FROM user_presence WHERE identity = ?');
    $stmt->execute([$other]);
    $row = $stmt->fetch();
    if (!$row) {
        return ['other_last_seen' => null, 'other_age_seconds' => null];
    }
    return [
        'other_last_seen'   => (new DateTime($row['last_seen'], new DateTimeZone('UTC')))->format(DateTime::ATOM),
        'other_age_seconds' => (int)$row['age'],
    ];
}

function isoUtc(?string $value): ?string {
    if ($value === null || $value === '') return null;
    return (new DateTime($value, new DateTimeZone('UTC')))->format(DateTime::ATOM);
}

/**
 * Loads messages in ID order with their reply quotes, attachments and reactions.
 *
 * A deleted message is returned as a tombstone: no body, attachments or
 * reactions, only its identity and times, so every client can replace what it
 * holds. A reply quote carries at most 200 characters of its parent and no text
 * once the parent is deleted. IDs that do not exist are left out.
 *
 * @param int[] $ids Message IDs; duplicates are ignored.
 * @return array[] One API message object per existing ID.
 */
function loadMessagesById(PDO $db, array $ids): array {
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if (empty($ids)) return [];
    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    $stmt = $db->prepare(
        "SELECT m.id, m.sender_identity, m.message_body, m.created_at, m.edited_at, m.is_deleted, m.reply_to_id,
                rm.sender_identity         AS reply_to_sender,
                LEFT(rm.message_body, 200) AS reply_to_body,
                rm.is_deleted              AS reply_to_is_deleted
         FROM messages m
         LEFT JOIN messages rm ON rm.id = m.reply_to_id
         WHERE m.id IN ($placeholders)
         ORDER BY m.id ASC"
    );
    $stmt->execute($ids);
    $rows = $stmt->fetchAll();

    $aStmt = $db->prepare("SELECT id, message_id, original_name, mime_type, file_size FROM attachments WHERE message_id IN ($placeholders) ORDER BY id");
    $aStmt->execute($ids);
    $attachments = [];
    foreach ($aStmt->fetchAll() as $a) {
        $attachments[(int)$a['message_id']][] = [
            'id'            => (int)$a['id'],
            'original_name' => $a['original_name'],
            'mime_type'     => $a['mime_type'],
            'file_size'     => $a['file_size'] === null ? null : (int)$a['file_size'],
        ];
    }

    $rStmt = $db->prepare("SELECT message_id, emoji, sender_identity AS identity FROM message_reactions WHERE message_id IN ($placeholders) ORDER BY id");
    $rStmt->execute($ids);
    $reactions = [];
    foreach ($rStmt->fetchAll() as $r) {
        $reactions[(int)$r['message_id']][] = ['emoji' => $r['emoji'], 'identity' => $r['identity']];
    }

    $out = [];
    foreach ($rows as $row) {
        $id = (int)$row['id'];
        $deleted = (int)$row['is_deleted'] === 1;
        $hasParent = $row['reply_to_sender'] !== null;
        $out[] = [
            'id'                  => $id,
            'sender_identity'     => $row['sender_identity'],
            'message_body'        => $deleted ? '' : $row['message_body'],
            'created_at'          => isoUtc($row['created_at']),
            'edited_at'           => isoUtc($row['edited_at']),
            'is_deleted'          => $deleted ? 1 : 0,
            'reply_to_id'         => $hasParent ? (int)$row['reply_to_id'] : null,
            'reply_to_sender'     => $hasParent ? $row['reply_to_sender'] : null,
            'reply_to_body'       => $hasParent && (int)$row['reply_to_is_deleted'] !== 1 ? $row['reply_to_body'] : null,
            'reply_to_is_deleted' => $hasParent ? (int)$row['reply_to_is_deleted'] : null,
            'attachments'         => $deleted ? [] : ($attachments[$id] ?? []),
            'reactions'           => $deleted ? [] : ($reactions[$id] ?? []),
        ];
    }
    return $out;
}

/**
 * Runs an endpoint handler and turns every failure into a JSON response.
 *
 * ApiFailure keeps its own status and body. Anything else is logged with its
 * class and message and answered as a bare 500, so no query, path or stack
 * reaches the client.
 */
function runApi(callable $handler): void {
    try {
        $handler();
    } catch (ApiFailure $e) {
        respond($e->status, $e->body);
    } catch (Throwable $e) {
        error_log('mirage: ' . get_class($e) . ': ' . $e->getMessage());
        respond(500, ['error' => 'server_error']);
    }
}
