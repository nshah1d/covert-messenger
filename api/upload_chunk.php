<?php
/**
 * POST /api/upload_chunk.php: stores one chunk of the caller's upload.
 *
 * Form fields: upload_id, chunk_index and the chunk file. The index must lie in
 * the manifest's range and the chunk must have exactly the expected length, so
 * the assembled file cannot grow past the declared size. A chunk sent again
 * replaces the earlier copy.
 */

require_once __DIR__ . '/../includes/auth_check.php';
$identity = validateToken();

require_once __DIR__ . '/../includes/uploads.php';

runApi(function () use ($identity) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        header('Allow: POST');
        failWith(405, 'method_not_allowed');
    }

    [$dir, $manifest] = stagingFor($_POST['upload_id'] ?? null, $identity);

    $rawIndex = $_POST['chunk_index'] ?? '';
    if (!is_string($rawIndex) || !preg_match('/^(0|[1-9][0-9]{0,8})$/', $rawIndex)) failWith(400, 'invalid_chunk_index');
    $index = (int)$rawIndex;
    if ($index >= $manifest['total_chunks']) failWith(400, 'invalid_chunk_index');

    $chunk = $_FILES['chunk'] ?? null;
    if (!$chunk || $chunk['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($chunk['tmp_name'])) failWith(400, 'upload_failed');
    if (filesize($chunk['tmp_name']) !== expectedChunkBytes($manifest, $index)) failWith(400, 'chunk_size_mismatch');

    if (!move_uploaded_file($chunk['tmp_name'], $dir . '/' . $index . '.tmp')) failWith(500, 'save_failed');
    touch($dir);

    respond(200, ['received' => $index]);
});
