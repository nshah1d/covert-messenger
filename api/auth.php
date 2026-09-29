<?php
/**
 * POST /api/auth.php: exchanges a date key for a chat token.
 *
 * The key is the visitor's local date: ddmmyyyy enters as user-a and yyyymmdd as
 * user-b, and the previous hour's date is also accepted so a key typed just
 * after midnight still works. The key is a showcase gate that anyone reading the
 * source can derive; it is paired with a per-address lockout.
 *
 * Body: {"passcode", "timezone", "fingerprint" (64 lowercase hex)}.
 * Responses: 200 {"status":"chat","token","nonce","identity"}; 400 for a
 * malformed fingerprint; 401 for a wrong key; 423 {"error":"locked","until"}
 * while the address is locked; 500 on a database failure.
 */

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['error' => 'Method not allowed']));
}

require_once __DIR__ . '/../includes/db.php';

$input = json_decode(file_get_contents('php://input'), true);
$input = is_array($input) ? $input : [];
$passcode = is_string($input['passcode'] ?? null) ? $input['passcode'] : '';
$timezone = is_string($input['timezone'] ?? null) ? $input['timezone'] : 'UTC';
$fingerprint = is_string($input['fingerprint'] ?? null) ? $input['fingerprint'] : '';

if (!preg_match('/^[0-9a-f]{64}$/', $fingerprint)) {
    http_response_code(400);
    exit(json_encode(['error' => 'invalid']));
}

$ip = $_SERVER['REMOTE_ADDR'];

// The address is stored only as a salted PBKDF2 hash (RFC 8018 section 5.2:
// https://www.rfc-editor.org/rfc/rfc8018#section-5.2), so the table never holds
// a readable IP address.
$hashedIp = hash_pbkdf2('sha256', $ip, TOKEN_SALT, 100000, 32, false);

try {
    $db = getDB();
    $db->beginTransaction();

    // The table has no unique key on the address and may hold older duplicate
    // rows, so the lowest ID is the one row every attempt reads and writes. FOR
    // UPDATE makes concurrent attempts from one address count one after another.
    $stmt = $db->prepare("SELECT id, failed_attempts, locked_until,
                                 locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP() AS is_locked,
                                 last_attempt IS NULL OR last_attempt < UTC_TIMESTAMP() - INTERVAL 1 DAY AS is_stale
                          FROM users_meta WHERE ip_address = ? ORDER BY id ASC LIMIT 1 FOR UPDATE");
    $stmt->execute([$hashedIp]);
    $meta = $stmt->fetch();

    if ($meta && (int)$meta['is_locked'] === 1) {
        $db->commit();
        http_response_code(423);
        exit(json_encode(['error' => 'locked', 'until' => $meta['locked_until']]));
    }

    if ($meta) {
        $rowId = (int)$meta['id'];
        // An expired lock or a day without attempts starts the count again.
        $attempts = ($meta['locked_until'] !== null || (int)$meta['is_stale'] === 1) ? 0 : (int)$meta['failed_attempts'];
    } else {
        $db->prepare("INSERT INTO users_meta (ip_address, failed_attempts, locked_until, last_attempt) VALUES (?, 0, NULL, UTC_TIMESTAMP())")
           ->execute([$hashedIp]);
        $rowId = (int)$db->lastInsertId();
        $attempts = 0;
    }

    try {
        $clientTz = new DateTimeZone($timezone);
    } catch (Exception $e) {
        $clientTz = new DateTimeZone('UTC');
    }

    $now = new DateTime('now', $clientTz);
    $nowMinus1h = clone $now;
    $nowMinus1h->modify('-1 hour');

    $validUserACodes = [
        $now->format('dmY'),
        $nowMinus1h->format('dmY')
    ];

    $validUserBCodes = [
        $now->format('Ymd'),
        $nowMinus1h->format('Ymd')
    ];

    $identity = null;
    if (in_array($passcode, $validUserACodes, true)) {
        $identity = 'user-a';
    } elseif (in_array($passcode, $validUserBCodes, true)) {
        $identity = 'user-b';
    }

    if ($identity !== null) {
        $db->prepare("UPDATE users_meta SET failed_attempts = 0, locked_until = NULL, last_attempt = UTC_TIMESTAMP() WHERE id = ?")
           ->execute([$rowId]);
        $db->commit();

        $tokenDate = new DateTime('now', new DateTimeZone('UTC'));
        $serverDate = $tokenDate->format('dmY');
        $token = hash_hmac('sha256', $fingerprint . $serverDate . $identity, TOKEN_SALT);
        // The nonce is stored with each message this login sends, and editing or
        // deleting a message requires the same nonce, so only the login that wrote
        // a message can change it.
        $nonce = bin2hex(random_bytes(32));

        exit(json_encode(['status' => 'chat', 'token' => $token, 'nonce' => $nonce, 'identity' => $identity]));
    }

    $attempts++;
    $lockedUntil = null;
    // The third failure counted since the last reset locks the address for 24 hours.
    if ($attempts >= 3) {
        $lockedUntil = (new DateTime('+24 hours', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');
    }
    $db->prepare("UPDATE users_meta SET failed_attempts = ?, locked_until = ?, last_attempt = UTC_TIMESTAMP() WHERE id = ?")
       ->execute([min($attempts, 255), $lockedUntil, $rowId]);
    $db->commit();

    if ($lockedUntil !== null) {
        http_response_code(423);
        exit(json_encode(['error' => 'locked', 'until' => $lockedUntil]));
    }

    http_response_code(401);
    exit(json_encode(['error' => 'invalid']));
} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    http_response_code(500);
    exit(json_encode(['error' => 'database_error']));
}
