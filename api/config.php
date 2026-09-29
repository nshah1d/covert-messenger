<?php
/**
 * Loads KEY=VALUE pairs from the .env file one level above api/ into constants.
 *
 * The file sits outside the served API directory and holds the only secrets:
 * the database credentials and TOKEN_SALT. Lines starting with # are skipped,
 * and a missing file or an empty required value stops the request before any
 * query runs. A value of 0 is a value.
 */
$envPath = dirname(__FILE__) . '/../.env';
if (!file_exists($envPath)) {
    throw new RuntimeException('.env file missing');
}

$lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
foreach ($lines as $line) {
    if (strpos(trim($line), '#') === 0) continue;
    $parts = explode('=', $line, 2);
    if (count($parts) === 2) {
        define(trim($parts[0]), trim($parts[1]));
    }
}

$required = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'TOKEN_SALT'];
foreach ($required as $constant) {
    if (!defined($constant) || (string) constant($constant) === '') {
        throw new RuntimeException("Required constant $constant is missing or empty");
    }
}
