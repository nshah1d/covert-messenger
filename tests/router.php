<?php
/**
 * Router for PHP's built-in server that reproduces .htaccess for the gates.
 *
 * Every response, static files included, is sent by this script, because the
 * built-in server drops the headers set here when a router hands a file back to
 * it with `return false`; the page would then run without its content security
 * policy.
 */
$root = $_SERVER['DOCUMENT_ROOT'];
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));

if (isset($_SERVER['HTTP_X_GATE_REMOTE_ADDR'])) {
    $_SERVER['REMOTE_ADDR'] = $_SERVER['HTTP_X_GATE_REMOTE_ADDR'];
}

$headers = getenv('MIRAGE_GATE_HEADERS');
if ($headers) {
    foreach (json_decode($headers, true) as $name => $value) {
        header($name . ': ' . $value);
    }
}

if (preg_match('#^/api/[a-z_]+\.php$#', $path) && is_file($root . $path)) {
    chdir(dirname($root . $path));
    require $root . $path;
    return true;
}

if (preg_match('#(^|/)\.|^/(includes|uploads|tests|docs)(/|$)|^/(schema\.sql|package\.json)$|\.md$#', $path)) {
    http_response_code(403);
    return true;
}

if (str_starts_with($path, '/api/')) {
    http_response_code(404);
    return true;
}

$types = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8',
    'json' => 'application/json', 'png' => 'image/png', 'woff2' => 'font/woff2', 'txt' => 'text/plain; charset=utf-8',
];
$file = $root . ($path === '/' ? '/index.html' : $path);
if (!is_file($file)) {
    $file = $root . '/index.html';
}
header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
if (preg_match('/\.(js|css|html|json)$/', $file)) {
    header('Cache-Control: no-cache');
}
http_response_code(200);
readfile($file);
return true;
