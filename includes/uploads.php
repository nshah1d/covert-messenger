<?php
require_once __DIR__ . '/chat.php';

// Every chunk except the last is exactly 1 MiB, which stays under common
// upload_max_filesize limits and lets each chunk length be checked exactly.
const UPLOAD_CHUNK_BYTES = 1048576;
const UPLOAD_STALE_SECONDS = 86400;

function uploadsDir(): string {
    return __DIR__ . '/../uploads/';
}

/**
 * Opens an upload's staging directory for the identity that started it.
 *
 * The 32-character hex format keeps the ID from naming any other path. A
 * directory owned by the other identity answers exactly as a missing one does.
 *
 * @return array [directory path, manifest array]
 * @throws ApiFailure 400 for a malformed ID, 404 when the upload is unknown,
 *                    a symbolic link, lacks a manifest or belongs to the other identity.
 */
function stagingFor($uploadId, string $identity): array {
    if (!is_string($uploadId) || !preg_match('/^[0-9a-f]{32}$/', $uploadId)) failWith(400, 'invalid_upload_id');
    $dir = uploadsDir() . $uploadId;
    $manifestPath = $dir . '/manifest.json';
    if (!is_dir($dir) || is_link($dir) || !is_file($manifestPath)) failWith(404, 'upload_not_found');
    $manifest = json_decode((string)file_get_contents($manifestPath), true);
    if (!is_array($manifest) || ($manifest['identity'] ?? null) !== $identity) failWith(404, 'upload_not_found');
    return [$dir, $manifest];
}

/** Removes a staging directory's files and then the directory; subdirectories are never followed. */
function removeStagingDir(string $dir): void {
    foreach (scandir($dir) ?: [] as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . '/' . $item;
        if (is_file($path) || is_link($path)) @unlink($path);
    }
    @rmdir($dir);
}

/**
 * Removes staging directories untouched for a day.
 *
 * Only 32-character hex names are considered, so stored media and anything
 * else in uploads/ is never swept. Each received chunk refreshes its
 * directory's time, so an upload still in progress is kept.
 */
function sweepStaleStaging(): void {
    $dirs = glob(uploadsDir() . '*', GLOB_ONLYDIR);
    if ($dirs === false) return;
    $now = time();
    foreach ($dirs as $dir) {
        if (!preg_match('/^[0-9a-f]{32}$/', basename($dir)) || is_link($dir)) continue;
        if ($now - filemtime($dir) > UPLOAD_STALE_SECONDS) removeStagingDir($dir);
    }
}

/** The exact length chunk $index must have: 1 MiB, or the remainder for the last chunk. */
function expectedChunkBytes(array $manifest, int $index): int {
    return (int)min(UPLOAD_CHUNK_BYTES, $manifest['file_size'] - $index * UPLOAD_CHUNK_BYTES);
}
