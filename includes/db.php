<?php
require_once __DIR__ . '/../api/config.php';

/**
 * One PDO connection per request, created on first use.
 *
 * Native prepared statements keep parameters out of the SQL text. The session
 * runs in UTC so TIMESTAMP columns, UTC_TIMESTAMP() and the ISO 8601 strings
 * built from them all describe the same instant.
 *
 * @throws PDOException When the database refuses the connection.
 */
function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false
        ]);
        $pdo->exec("SET SESSION time_zone = '+00:00'");
    }
    return $pdo;
}
