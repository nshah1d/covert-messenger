<?php
/**
 * /api/upload_init.php: starts or cancels a chunked upload.
 *
 * POST {filename, file_size} creates uploads/<32 hex>/manifest.json holding the
 * identity, the cleaned name, the size and the chunk count, and answers with the
 * upload ID and chunk size. It refuses with 507 unless the size plus 50 MiB is
 * free. DELETE {upload_id} removes the caller's staging directory.
 */

require_once __DIR__ . '/../includes/auth_check.php';
$identity = validateToken();

require_once __DIR__ . '/../includes/uploads.php';

runApi(function () use ($identity) {
    $method = $_SERVER['REQUEST_METHOD'];
    $input = readJsonBody();

    if ($method === 'DELETE') {
        [$dir] = stagingFor($input['upload_id'] ?? null, $identity);
        removeStagingDir($dir);
        respond(200, ['status' => 'cancelled']);
    }

    if ($method !== 'POST') {
        header('Allow: POST, DELETE');
        failWith(405, 'method_not_allowed');
    }

    $fileSize = $input['file_size'] ?? null;
    if (!is_int($fileSize) || $fileSize <= 0) failWith(400, 'invalid_file_size');

    $filename = is_string($input['filename'] ?? null) ? $input['filename'] : '';
    // Control characters and path separators become underscores; the name is only
    // ever shown and offered for download, never used as a path.
    $filename = trim(preg_replace('/[\x00-\x1f\x7f\/\\\\]/u', '_', $filename) ?? '');
    if ($filename === '' || $filename === '.' || $filename === '..') $filename = 'file';
    // A name over 255 bytes keeps its first 200 characters and a short extension.
    if (strlen($filename) > 255) {
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $filename = preg_replace('/^(.{0,200}).*$/us', '$1', $filename) . ($ext !== '' && strlen($ext) <= 10 ? '.' . $ext : '');
    }

    $uploads = uploadsDir();
    $free = disk_free_space($uploads);
    if ($free === false || $free < ($fileSize + 52428800)) failWith(507, 'insufficient_storage');

    sweepStaleStaging();

    $uploadId = bin2hex(random_bytes(16));
    $dir = $uploads . $uploadId;
    if (!mkdir($dir, 0755)) failWith(500, 'directory_creation_failed');

    $manifest = [
        'identity'     => $identity,
        'filename'     => $filename,
        'file_size'    => $fileSize,
        'total_chunks' => (int)ceil($fileSize / UPLOAD_CHUNK_BYTES),
        'created'      => time(),
    ];
    if (file_put_contents($dir . '/manifest.json', json_encode($manifest)) === false) {
        removeStagingDir($dir);
        failWith(500, 'directory_creation_failed');
    }

    respond(200, ['upload_id' => $uploadId, 'chunk_size' => UPLOAD_CHUNK_BYTES, 'total_chunks' => $manifest['total_chunks']]);
});
