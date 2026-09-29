<?php
/**
 * /api/media.php?id=<attachment ID>: serves or discards one attachment.
 *
 * GET streams the file. DELETE removes an attachment that was uploaded but never
 * sent, and answers 409 once it belongs to a message. A pending attachment is
 * visible only to its uploader, and media of a deleted message answers 404;
 * both answer exactly as a missing attachment does.
 */

require_once __DIR__ . '/../includes/auth_check.php';
$identity = validateToken();

require_once __DIR__ . '/../includes/chat.php';

// Only raster images, video, audio and PDF are served inline. Anything else,
// including HTML and SVG, which could run script in the site's origin, goes out
// as application/octet-stream with an attachment disposition, and nosniff stops
// the browser guessing otherwise.
const INLINE_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac',
    'application/pdf',
];

runApi(function () use ($identity) {
    $method = $_SERVER['REQUEST_METHOD'];
    if ($method !== 'GET' && $method !== 'DELETE') {
        header('Allow: GET, DELETE');
        failWith(405, 'method_not_allowed');
    }

    $id = positiveId($_GET['id'] ?? null);
    if ($id === null) failWith(400, 'invalid_id');

    $db = getDB();
    $stmt = $db->prepare('SELECT a.message_id, a.file_path, a.mime_type, a.original_name, m.is_deleted, o.sender_identity AS uploader
                          FROM attachments a
                          LEFT JOIN messages m ON m.id = a.message_id
                          LEFT JOIN attachment_owners o ON o.attachment_id = a.id
                          WHERE a.id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || (int)$row['is_deleted'] === 1) failWith(404, 'not_found');
    if ($row['message_id'] === null && $row['uploader'] !== $identity) failWith(404, 'not_found');

    $baseDir = realpath(__DIR__ . '/../uploads');
    // basename() and the prefix checks below keep a stored path from leaving uploads/.
    $absPath = realpath($baseDir . '/' . basename($row['file_path']));

    if ($method === 'DELETE') {
        if ($row['message_id'] !== null) failWith(409, 'already_sent');
        $removed = $db->prepare('DELETE FROM attachments WHERE id = ? AND message_id IS NULL');
        $removed->execute([$id]);
        if ($removed->rowCount() !== 1) failWith(409, 'already_sent');
        if ($absPath && strpos($absPath, $baseDir . DIRECTORY_SEPARATOR) === 0) @unlink($absPath);
        respond(200, ['status' => 'discarded']);
    }

    if (!$absPath || strpos($absPath, $baseDir . DIRECTORY_SEPARATOR) !== 0 || !is_file($absPath)) failWith(404, 'not_found');

    $mime = strtolower((string)$row['mime_type']);
    $inline = in_array($mime, INLINE_TYPES, true);
    $name = basename($row['original_name'] ?? $row['file_path']);

    header('Content-Type: ' . ($inline ? $mime : 'application/octet-stream'));
    // filename* carries the original name in UTF-8 (RFC 6266 section 4.3:
    // https://www.rfc-editor.org/rfc/rfc6266#section-4.3); the plain filename is
    // a fixed ASCII fallback, so no stored name can break the header.
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . "; filename=\"file\"; filename*=UTF-8''" . rawurlencode($name));
    header('Content-Length: ' . filesize($absPath));
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');

    readfile($absPath);
    exit;
});
