<?php
/**
 * POST /api/upload_complete.php {upload_id}: assembles a finished upload.
 *
 * Every chunk must be present at its exact length. The file is written under a
 * random name that keeps a short lowercase extension, checked against the
 * blocked extensions and then against the type detected from its contents, and
 * recorded as a pending attachment owned by the uploader, which only a message
 * from that identity can claim. Both checks run
 * because a script renamed to an allowed extension passes the first, and a
 * blocked extension on harmless-looking contents passes the second.
 * A missing chunk leaves the staging directory in place so the client can send
 * it again.
 */

require_once __DIR__ . '/../includes/auth_check.php';
$identity = validateToken();

require_once __DIR__ . '/../includes/uploads.php';

const BLOCKED_EXTS = ['php','phtml','php3','php4','php5','php7','phar','cgi','pl','py','rb','sh','bash','exe','bat','cmd','msi','jar','jsp','asp','aspx','htaccess'];
const BLOCKED_MIMES = [
    'application/x-php',
    'application/x-httpd-php',
    'text/x-php',
    'application/x-sh',
    'application/x-executable',
    'application/x-msdownload',
    'text/x-shellscript',
];

runApi(function () use ($identity) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        header('Allow: POST');
        failWith(405, 'method_not_allowed');
    }

    $input = readJsonBody();
    [$dir, $manifest] = stagingFor($input['upload_id'] ?? null, $identity);

    $filename = $manifest['filename'];
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (in_array($ext, BLOCKED_EXTS, true)) {
        removeStagingDir($dir);
        failWith(415, 'unsupported_file_type');
    }
    $safeExt = preg_match('/^[a-z0-9]{1,10}$/', $ext) ? '.' . $ext : '';

    for ($i = 0; $i < $manifest['total_chunks']; $i++) {
        $chunkPath = $dir . '/' . $i . '.tmp';
        if (!is_file($chunkPath) || is_link($chunkPath) || filesize($chunkPath) !== expectedChunkBytes($manifest, $i)) {
            failWith(400, 'missing_chunks', ['index' => $i]);
        }
    }

    $finalFilename = bin2hex(random_bytes(16)) . $safeExt;
    $finalPath = uploadsDir() . $finalFilename;
    $out = fopen($finalPath, 'xb');
    if (!$out) failWith(500, 'assembly_failed');
    $written = 0;
    for ($i = 0; $i < $manifest['total_chunks']; $i++) {
        $in = fopen($dir . '/' . $i . '.tmp', 'rb');
        $copied = $in ? stream_copy_to_stream($in, $out) : false;
        if ($in) fclose($in);
        if ($copied === false) {
            fclose($out);
            @unlink($finalPath);
            failWith(500, 'assembly_failed');
        }
        $written += $copied;
    }
    fclose($out);

    if ($written !== $manifest['file_size']) {
        @unlink($finalPath);
        removeStagingDir($dir);
        failWith(400, 'size_mismatch');
    }

    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $detectedMime = finfo_file($finfo, $finalPath);
        finfo_close($finfo);
    } elseif (function_exists('mime_content_type')) {
        $detectedMime = mime_content_type($finalPath);
    } else {
        $extMap = [
            'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
            'gif' => 'image/gif',  'webp' => 'image/webp', 'svg' => 'image/svg+xml',
            'mp4' => 'video/mp4',  'mov' => 'video/quicktime', 'webm' => 'video/webm',
            'mp3' => 'audio/mpeg', 'aac' => 'audio/aac',  'wav' => 'audio/wav',
            'ogg' => 'audio/ogg',  'pdf' => 'application/pdf',
            'txt' => 'text/plain', 'md'  => 'text/plain',
            'json'=> 'application/json',
        ];
        $detectedMime = $extMap[$ext] ?? 'application/octet-stream';
    }

    if (in_array($detectedMime, BLOCKED_MIMES, true)) {
        @unlink($finalPath);
        removeStagingDir($dir);
        failWith(415, 'unsupported_file_type');
    }

    $mime = $detectedMime ?: 'application/octet-stream';
    removeStagingDir($dir);

    $db = getDB();
    $db->beginTransaction();
    try {
        $db->prepare('INSERT INTO attachments (message_id, file_path, original_name, mime_type, file_size) VALUES (NULL, ?, ?, ?, ?)')
           ->execute([$finalFilename, $filename, $mime, $written]);
        $attachmentId = (int)$db->lastInsertId();
        $db->prepare('INSERT INTO attachment_owners (attachment_id, sender_identity) VALUES (?, ?)')
           ->execute([$attachmentId, $identity]);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        @unlink($finalPath);
        throw $e;
    }

    respond(200, [
        'attachment_id' => $attachmentId,
        'id'            => $attachmentId,
        'original_name' => $filename,
        'mime_type'     => $mime,
        'file_size'     => $written,
    ]);
});
