<?php
/**
 * GET /api/link_preview.php?url=<address>: title, description and image for a link.
 *
 * An address without a scheme is read as HTTPS. The page is fetched under the
 * destination rules in includes/preview.php, following up to three checked
 * redirects. Responds with {title, description, image}; 400 for a refused
 * address and 403 for a destination that is not public.
 */

require_once __DIR__ . '/../includes/auth_check.php';
validateToken();

require_once __DIR__ . '/../includes/preview.php';

runApi(function () {
    $url = is_string($_GET['url'] ?? null) ? trim($_GET['url']) : '';
    if (!preg_match('/^https?:\/\//i', $url)) {
        $url = 'https://' . $url;
    }
    $page = fetchPreviewPage($url);
    header('Content-Type: application/json');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    exit(json_encode(previewFields($page['html'], $page['host']), JSON_INVALID_UTF8_SUBSTITUTE));
});
