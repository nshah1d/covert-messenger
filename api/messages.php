<?php
/**
 * /api/messages.php: reads, sends, edits and deletes chat messages.
 *
 * GET reads one of: ?initial (latest 50 and the feed cursor), ?after=<event ID>
 * (messages changed since the cursor), ?around=<message ID> (a window around one
 * message), ?search=<text>, ?media_only, or plain pages with ?before and ?limit.
 * POST sends, PATCH edits and DELETE deletes; every change goes through
 * withFeedLock() so the other identity's feed carries it.
 */

require_once __DIR__ . '/../includes/auth_check.php';
$identity = validateToken();

require_once __DIR__ . '/../includes/chat.php';

runApi(function () use ($identity) {
    $db = getDB();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        handleRead($db, $identity);
    }
    if ($method === 'POST') {
        handleSend($db, $identity);
    }
    if ($method === 'PATCH' || $method === 'DELETE') {
        handleChange($db, $identity, $method);
    }
    header('Allow: GET, POST, PATCH, DELETE');
    failWith(405, 'method_not_allowed');
});

/**
 * The newest message IDs matching $where, one more than $limit so the caller can
 * tell whether older rows exist. $where is always built in this file from fixed
 * fragments; values travel in $params.
 */
function newestIds(PDO $db, string $where, array $params, int $limit): array {
    $stmt = $db->prepare("SELECT m.id FROM messages m WHERE $where ORDER BY m.id DESC LIMIT " . ($limit + 1));
    $stmt->execute($params);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

function handleRead(PDO $db, string $identity): void {
    if (isset($_GET['initial'])) {
        touchPresence($db, $identity);
        // The cursor is read before the messages, so a change committed between
        // the two reads is delivered again by the next poll rather than missed.
        $cursor = feedCursor($db);
        $ids = newestIds($db, '1=1', [], 50);
        $hasOlder = count($ids) > 50;
        respond(200, [
            'messages'  => loadMessagesById($db, array_slice($ids, 0, 50)),
            'cursor'    => $cursor,
            'has_older' => $hasOlder,
            'presence'  => otherPresence($db, $identity),
        ]);
    }

    if (isset($_GET['after'])) {
        $after = $_GET['after'] === '0' ? 0 : positiveId($_GET['after']);
        if ($after === null) failWith(400, 'invalid_cursor');
        touchPresence($db, $identity);
        // At most 200 events per poll; has_more tells the client to poll again at once.
        $stmt = $db->prepare('SELECT id, message_id FROM message_events WHERE id > ? ORDER BY id ASC LIMIT 201');
        $stmt->execute([$after]);
        $events = $stmt->fetchAll();
        $hasMore = count($events) > 200;
        $events = array_slice($events, 0, 200);
        $cursor = $events ? (int)end($events)['id'] : $after;
        respond(200, [
            'messages' => loadMessagesById($db, array_column($events, 'message_id')),
            'cursor'   => $cursor,
            'has_more' => $hasMore,
            'presence' => otherPresence($db, $identity),
        ]);
    }

    // The pivot with up to 25 messages either side, deleted ones included, so a
    // jump to an old message opens a contiguous window around it.
    if (isset($_GET['around'])) {
        $pivot = positiveId($_GET['around']);
        if ($pivot === null) failWith(400, 'invalid_id');
        $before = $db->prepare('SELECT id FROM messages WHERE id < ? ORDER BY id DESC LIMIT 26');
        $before->execute([$pivot]);
        $older = array_map('intval', $before->fetchAll(PDO::FETCH_COLUMN));
        $after = $db->prepare('SELECT id FROM messages WHERE id >= ? ORDER BY id ASC LIMIT 26');
        $after->execute([$pivot]);
        $newer = array_map('intval', $after->fetchAll(PDO::FETCH_COLUMN));
        if (!in_array($pivot, $newer, true)) failWith(404, 'not_found');
        respond(200, [
            'messages'  => loadMessagesById($db, array_merge(array_slice($older, 0, 25), array_slice($newer, 0, 26))),
            'has_older' => count($older) > 25,
        ]);
    }

    $limit = boundedLimit($_GET['limit'] ?? null);
    $where = '1=1';
    $params = [];
    if (isset($_GET['before'])) {
        $before = positiveId($_GET['before']);
        if ($before === null) failWith(400, 'invalid_id');
        $where .= ' AND m.id < ?';
        $params[] = $before;
    }

    if (isset($_GET['search'])) {
        $q = is_string($_GET['search']) ? trim($_GET['search']) : '';
        if ($q === '' || strlen($q) > 500) respond(200, ['messages' => [], 'has_more' => false]);
        // % and _ in the query are matched literally, not as wildcards.
        $where .= " AND m.is_deleted = 0 AND m.message_body LIKE ? ESCAPE '\\\\'";
        $params[] = '%' . addcslashes($q, '%_\\') . '%';
        $ids = newestIds($db, $where, $params, $limit);
        respond(200, ['messages' => array_reverse(loadMessagesById($db, array_slice($ids, 0, $limit))), 'has_more' => count($ids) > $limit]);
    }

    if (isset($_GET['media_only'])) {
        $where .= ' AND m.is_deleted = 0 AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)';
        $ids = newestIds($db, $where, $params, $limit);
        respond(200, ['messages' => array_reverse(loadMessagesById($db, array_slice($ids, 0, $limit))), 'has_more' => count($ids) > $limit]);
    }

    $ids = newestIds($db, $where, $params, $limit);
    respond(200, ['messages' => loadMessagesById($db, array_slice($ids, 0, $limit)), 'has_older' => count($ids) > $limit]);
}

/**
 * Stores a message and links its uploaded attachments.
 *
 * Body: {message_body, client_id (32 hex), session_nonce, reply_to_id,
 * attachment_ids (at most 20)}. A message may be text, attachments or both, up
 * to 60,000 bytes of text. client_id makes the send idempotent per identity: a
 * retry of a send that already landed returns the stored message with 200
 * instead of creating a second one with 201. Only attachments the caller
 * uploaded and has not yet sent can be linked, and they are locked while the
 * message is written.
 */
function handleSend(PDO $db, string $identity): void {
    $input = readJsonBody();
    $body = isset($input['message_body']) && is_string($input['message_body']) ? trim(str_replace("\r\n", "\n", $input['message_body'])) : '';
    $clientId = $input['client_id'] ?? '';
    $nonce = $input['session_nonce'] ?? null;
    $replyTo = isset($input['reply_to_id']) && $input['reply_to_id'] !== null ? positiveId($input['reply_to_id']) : null;
    $requested = is_array($input['attachment_ids'] ?? null) ? $input['attachment_ids'] : [];

    if (!is_string($clientId) || !preg_match('/^[0-9a-f]{32}$/', $clientId)) failWith(400, 'invalid_request');
    if (isset($input['reply_to_id']) && $input['reply_to_id'] !== null && $replyTo === null) failWith(400, 'invalid_reply');
    if (strlen($body) > 60000) failWith(400, 'message_too_long');
    if (count($requested) > 20) failWith(400, 'too_many_attachments');
    $attachmentIds = [];
    foreach ($requested as $value) {
        $id = positiveId($value);
        if ($id === null) failWith(400, 'invalid_attachment');
        $attachmentIds[$id] = $id;
    }
    $attachmentIds = array_values($attachmentIds);
    if ($body === '' && !$attachmentIds) failWith(400, 'empty_body');
    $safeNonce = (is_string($nonce) && preg_match('/^[0-9a-f]{64}$/', $nonce)) ? $nonce : null;

    $result = withFeedLock($db, function (PDO $db) use ($identity, $body, $clientId, $safeNonce, $replyTo, $attachmentIds) {
        $seen = $db->prepare('SELECT message_id FROM message_requests WHERE sender_identity = ? AND client_id = ?');
        $seen->execute([$identity, $clientId]);
        $existing = $seen->fetchColumn();
        if ($existing !== false) {
            return ['changed' => [], 'value' => ['id' => (int)$existing, 'status' => 200]];
        }

        if ($replyTo !== null) {
            $parent = $db->prepare('SELECT id FROM messages WHERE id = ?');
            $parent->execute([$replyTo]);
            if ($parent->fetchColumn() === false) failWith(400, 'invalid_reply');
        }

        if ($attachmentIds) {
            $placeholders = implode(',', array_fill(0, count($attachmentIds), '?'));
            $pending = $db->prepare("SELECT a.id FROM attachments a JOIN attachment_owners o ON o.attachment_id = a.id
                                     WHERE a.id IN ($placeholders) AND a.message_id IS NULL AND o.sender_identity = ? FOR UPDATE");
            $pending->execute(array_merge($attachmentIds, [$identity]));
            if (count($pending->fetchAll(PDO::FETCH_COLUMN)) !== count($attachmentIds)) failWith(409, 'attachment_unavailable');
        }

        $db->prepare('INSERT INTO messages (sender_identity, message_body, session_nonce, reply_to_id) VALUES (?, ?, ?, ?)')
           ->execute([$identity, $body, $safeNonce, $replyTo]);
        $messageId = (int)$db->lastInsertId();

        $link = $db->prepare('UPDATE attachments SET message_id = ? WHERE id = ? AND message_id IS NULL');
        foreach ($attachmentIds as $attachmentId) {
            $link->execute([$messageId, $attachmentId]);
        }
        $db->prepare('INSERT INTO message_requests (sender_identity, client_id, message_id) VALUES (?, ?, ?)')
           ->execute([$identity, $clientId, $messageId]);

        return ['changed' => [$messageId], 'value' => ['id' => $messageId, 'status' => 201]];
    });

    respond($result['status'], loadMessagesById($db, [$result['id']])[0]);
}

/**
 * Edits (PATCH) or deletes (DELETE) one of the caller's own messages.
 *
 * A change is allowed for 120 seconds after sending, only by the identity that
 * sent the message and only with the nonce of the login that sent it. An edit
 * may empty the text only when the message has attachments. A deletion keeps
 * the row as a tombstone and removes the attachment files after the transaction
 * commits, so a rolled-back deletion never loses a file. Replies quoting the
 * message get events too, so their quotes update everywhere.
 */
function handleChange(PDO $db, string $identity, string $method): void {
    $input = readJsonBody();
    $id = positiveId($input['id'] ?? null);
    $nonce = $input['session_nonce'] ?? null;
    if ($id === null) failWith(400, 'invalid_input');

    $body = null;
    if ($method === 'PATCH') {
        $body = isset($input['message_body']) && is_string($input['message_body']) ? trim(str_replace("\r\n", "\n", $input['message_body'])) : null;
        if ($body === null) failWith(400, 'invalid_input');
        if (strlen($body) > 60000) failWith(400, 'message_too_long');
    }

    $files = withFeedLock($db, function (PDO $db) use ($identity, $method, $id, $nonce, $body) {
        $stmt = $db->prepare('SELECT sender_identity, session_nonce, is_deleted, TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP()) AS age FROM messages WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $msg = $stmt->fetch();
        if (!$msg) failWith(404, 'not_found');
        if ($msg['sender_identity'] !== $identity) failWith(403, 'forbidden');
        if ((int)$msg['is_deleted'] === 1) failWith(409, 'already_deleted');
        if ((int)$msg['age'] > 120) failWith(403, 'edit_window_expired');
        if (!$msg['session_nonce'] || !is_string($nonce) || !hash_equals($msg['session_nonce'], $nonce)) failWith(403, 'forbidden');

        $files = [];
        if ($method === 'PATCH') {
            if ($body === '') {
                $has = $db->prepare('SELECT 1 FROM attachments WHERE message_id = ? LIMIT 1');
                $has->execute([$id]);
                if ($has->fetchColumn() === false) failWith(400, 'empty_body');
            }
            $db->prepare('UPDATE messages SET message_body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$body, $id]);
        } else {
            $paths = $db->prepare('SELECT file_path FROM attachments WHERE message_id = ?');
            $paths->execute([$id]);
            $files = $paths->fetchAll(PDO::FETCH_COLUMN);
            $db->prepare("UPDATE messages SET is_deleted = 1, message_body = '', edited_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$id]);
        }

        $children = $db->prepare('SELECT id FROM messages WHERE reply_to_id = ?');
        $children->execute([$id]);
        $changed = array_merge([$id], array_map('intval', $children->fetchAll(PDO::FETCH_COLUMN)));
        return ['changed' => $changed, 'value' => $files];
    });

    foreach ($files as $path) {
        @unlink(__DIR__ . '/../uploads/' . basename($path));
    }
    respond(200, loadMessagesById($db, [$id])[0]);
}
