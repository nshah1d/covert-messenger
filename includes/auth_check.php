<?php
require_once __DIR__ . '/../api/config.php';

/**
 * Resolves the caller's identity from the bearer token and the device fingerprint.
 *
 * A token is an HMAC-SHA256 (RFC 2104: https://www.rfc-editor.org/rfc/rfc2104)
 * of fingerprint, UTC date and identity under TOKEN_SALT, so the server keeps no
 * session state. Today's and yesterday's dates are both accepted: a token issued
 * just before midnight UTC keeps working into the next day and expires at the end
 * of it. The identity is never taken from the client. Comparison uses
 * hash_equals() so timing does not reveal how much of a token matched.
 *
 * @return string 'user-a' or 'user-b'.
 * Ends the request with 401 and {"error":"invalid"} when the token or the
 * fingerprint is missing or matches neither identity.
 */
function validateToken(): string {
    // Apache under CGI or FastCGI withholds Authorization; .htaccess copies it into
    // the environment, where it may arrive with the REDIRECT_ prefix.
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    $fingerprint = $_SERVER['HTTP_X_FINGERPRINT'] ?? '';

    $token = '';
    if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        $token = $matches[1];
    }

    if (empty($token) || empty($fingerprint)) {
        http_response_code(401);
        header('Content-Type: application/json');
        exit(json_encode(['error' => 'invalid']));
    }

    $tz = new DateTimeZone('UTC');
    $now = new DateTime('now', $tz);

    $todayDate     = $now->format('dmY');
    $yesterdayDate = (clone $now)->modify('-1 day')->format('dmY');

    $candidates = [
        'user-a' => [
            hash_hmac('sha256', $fingerprint . $todayDate . 'user-a', TOKEN_SALT),
            hash_hmac('sha256', $fingerprint . $yesterdayDate . 'user-a', TOKEN_SALT)
        ],
        'user-b' => [
            hash_hmac('sha256', $fingerprint . $todayDate . 'user-b', TOKEN_SALT),
            hash_hmac('sha256', $fingerprint . $yesterdayDate . 'user-b', TOKEN_SALT)
        ]
    ];

    foreach ($candidates as $identity => $tokens) {
        foreach ($tokens as $expectedToken) {
            if (hash_equals($expectedToken, $token)) {
                $_SERVER['AUTH_IDENTITY'] = $identity;
                return $identity;
            }
        }
    }

    http_response_code(401);
    header('Content-Type: application/json');
    exit(json_encode(['error' => 'invalid']));
}
