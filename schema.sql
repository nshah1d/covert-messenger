-- Entry attempts per address. ip_address holds a salted PBKDF2 hash, never the
-- address itself.
CREATE TABLE IF NOT EXISTS users_meta (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_address      VARCHAR(64) NOT NULL,
  failed_attempts TINYINT UNSIGNED DEFAULT 0,
  locked_until    DATETIME DEFAULT NULL,
  last_attempt    DATETIME DEFAULT NULL,
  INDEX idx_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A deleted message stays as a tombstone with is_deleted = 1 and an empty body.
-- session_nonce is the nonce of the login that sent it, required to edit or delete.
CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sender_identity ENUM('user-a','user-b') NOT NULL,
  message_body    TEXT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  edited_at       TIMESTAMP NULL DEFAULT NULL,
  is_deleted      TINYINT(1) NOT NULL DEFAULT 0,
  session_nonce   VARCHAR(64) NULL DEFAULT NULL,
  reply_to_id     BIGINT UNSIGNED NULL DEFAULT NULL,
  INDEX idx_created (created_at),
  CONSTRAINT fk_reply_to FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- message_id is NULL while an upload is pending and set when a message claims it.
CREATE TABLE IF NOT EXISTS attachments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id      BIGINT UNSIGNED DEFAULT NULL,
  file_path       VARCHAR(512) NOT NULL,
  original_name   VARCHAR(512) DEFAULT NULL,
  mime_type       VARCHAR(128),
  file_size       BIGINT UNSIGNED,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS message_reactions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id      BIGINT UNSIGNED NOT NULL,
  sender_identity ENUM('user-a','user-b') NOT NULL,
  emoji           VARCHAR(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE KEY idx_msg_ident_emoji (message_id, sender_identity, emoji)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- When each identity last polled; the other identity's age drives the presence dot.
CREATE TABLE IF NOT EXISTS user_presence (
  identity  ENUM('user-a','user-b') NOT NULL,
  last_seen DATETIME NOT NULL,
  PRIMARY KEY (identity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The change feed: one row per changed message, written in commit order under
-- the feed lock. Clients poll for rows above the last ID they saw.
CREATE TABLE IF NOT EXISTS message_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id  BIGINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_message (message_id),
  CONSTRAINT fk_event_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Each send's request ID, per identity, mapped to the stored message, so a
-- retried send returns the original instead of a duplicate.
CREATE TABLE IF NOT EXISTS message_requests (
  sender_identity ENUM('user-a','user-b') NOT NULL,
  client_id       CHAR(32) NOT NULL,
  message_id      BIGINT UNSIGNED NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sender_identity, client_id),
  CONSTRAINT fk_request_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The identity that uploaded each attachment. A pending attachment can be
-- viewed, sent or discarded only by its uploader.
CREATE TABLE IF NOT EXISTS attachment_owners (
  attachment_id   BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  sender_identity ENUM('user-a','user-b') NOT NULL,
  CONSTRAINT fk_owner_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
