<?php
require_once __DIR__ . '/chat.php';

const PREVIEW_MAX_BYTES = 524288;
const PREVIEW_MAX_REDIRECTS = 3;

/**
 * Checks a preview address and resolves the host it may be fetched from.
 *
 * Server-side request forgery rules (OWASP:
 * https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html):
 * HTTP or HTTPS on ports 80 and 443 only, no credentials in the address, and a
 * host that resolves to a public IPv4 address. The caller connects to the
 * returned address, so DNS cannot change between this check and the fetch.
 *
 * @return array{url: string, host: string, port: int, ip: string}
 * @throws ApiFailure 400 'invalid_url' for a malformed or refused address,
 *                    403 'blocked_destination' for a host that is not public.
 */
function previewTarget(string $url): array {
    if (strlen($url) > 2048 || !filter_var($url, FILTER_VALIDATE_URL)) failWith(400, 'invalid_url');
    $parsed = parse_url($url);
    $scheme = strtolower($parsed['scheme'] ?? '');
    $host = strtolower($parsed['host'] ?? '');
    $port = $parsed['port'] ?? ($scheme === 'https' ? 443 : 80);
    if (!in_array($scheme, ['http', 'https'], true) || $host === '' || isset($parsed['user']) || isset($parsed['pass']) || !in_array($port, [80, 443], true)) {
        failWith(400, 'invalid_url');
    }
    $ip = gethostbyname($host);
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
        failWith(403, 'blocked_destination');
    }
    return ['url' => $url, 'host' => $host, 'port' => $port, 'ip' => $ip];
}

/**
 * Resolves a Location header against the address that returned it.
 *
 * Handles absolute http(s) addresses, scheme-relative (//host/path),
 * root-relative (/path) and path-relative forms (RFC 3986 section 5.2:
 * https://www.rfc-editor.org/rfc/rfc3986#section-5.2). Dot segments are not
 * collapsed; the result is checked again by previewTarget() before any fetch.
 *
 * @return string|null The absolute address, or null for any other scheme.
 */
function resolveLocation(string $base, string $location): ?string {
    $location = trim($location);
    if ($location === '') return null;
    if (preg_match('#^https?://#i', $location)) return $location;
    if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $location)) return null;
    $parts = parse_url($base);
    $origin = strtolower($parts['scheme']) . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    if (str_starts_with($location, '//')) return strtolower($parts['scheme']) . ':' . $location;
    if (str_starts_with($location, '/')) return $origin . $location;
    $path = $parts['path'] ?? '/';
    return $origin . substr($path, 0, strrpos($path, '/') + 1) . $location;
}

/**
 * Fetches at most 512 KiB of a page, following up to three redirects.
 *
 * Every hop is checked by previewTarget() and pinned to the address it resolved
 * to, so a redirect cannot lead to a private address. Each request has a
 * 5-second limit.
 *
 * @return array{html: string, host: string} The page body, empty when the fetch
 *   failed or the redirects ran out, and the host of the last address fetched.
 * @throws ApiFailure When the first address, or any redirect, is refused.
 */
function fetchPreviewPage(string $url): array {
    $target = previewTarget($url);
    for ($hop = 0; $hop <= PREVIEW_MAX_REDIRECTS; $hop++) {
        $html = '';
        $location = null;
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $target['url'],
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; LinkPreview/1.0)',
            CURLOPT_RESOLVE        => ["{$target['host']}:{$target['port']}:{$target['ip']}"],
            CURLOPT_HEADERFUNCTION => function ($handle, $line) use (&$location) {
                if (preg_match('/^Location:\s*(.+)$/i', trim($line), $m)) $location = $m[1];
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION  => function ($handle, $chunk) use (&$html) {
                $room = PREVIEW_MAX_BYTES - strlen($html);
                if ($room <= 0) return 0;
                $html .= substr($chunk, 0, $room);
                return strlen($chunk) <= $room ? strlen($chunk) : 0;
            },
        ]);
        curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($status >= 300 && $status < 400 && $location !== null) {
            $next = resolveLocation($target['url'], $location);
            if ($next === null) break;
            $target = previewTarget($next);
            continue;
        }
        return ['html' => $status >= 200 && $status < 300 ? $html : '', 'host' => $target['host']];
    }
    return ['html' => '', 'host' => $target['host']];
}

/**
 * Title, description and image from Open Graph tags (https://ogp.me/), with the
 * page title and meta description as fallbacks and the host as the last title.
 * Only an HTTPS image is kept, and the text fields are clipped to 200 and 400
 * characters.
 *
 * @return array{title: string, description: string, image: string}
 */
function previewFields(string $html, string $host): array {
    $res = ['title' => '', 'description' => '', 'image' => ''];
    if ($html !== '') {
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $matches)) {
            $res['title'] = trim(html_entity_decode($matches[1]));
        }
        $tags = [
            'og:title'       => 'title',
            'og:description' => 'description',
            'og:image'       => 'image',
            'description'    => 'description'
        ];
        foreach ($tags as $property => $key) {
            if ($property === 'description' && !empty($res['description'])) continue;
            $patterns = [
                '/<meta[^>]+(?:property|name)=["\']' . preg_quote($property, '/') . '["\'][^>]+content=["\'](.*?)["\']/is',
                '/<meta[^>]+content=["\'](.*?)["\'][^>]+(?:property|name)=["\']' . preg_quote($property, '/') . '["\']/is'
            ];
            foreach ($patterns as $pattern) {
                if (preg_match($pattern, $html, $matches)) {
                    $res[$key] = html_entity_decode(trim($matches[1]));
                    break;
                }
            }
        }
    }
    if (!preg_match('/^https:\/\//i', $res['image'])) {
        $res['image'] = '';
    }
    $clip = fn (string $text, int $length) => function_exists('mb_substr') ? mb_substr($text, 0, $length) : substr($text, 0, $length);
    $res['title'] = $clip($res['title'] !== '' ? $res['title'] : $host, 200);
    $res['description'] = $clip($res['description'], 400);
    return $res;
}
