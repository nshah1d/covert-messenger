# Covert Messenger Configuration

Covert Messenger has no build-time configuration. Server secrets come from `.env`; public deployment metadata and chat display names are source placeholders replaced in a staging copy. Test gates read optional `MIRAGE_` environment variables from the process.

---

## Server Environment

`api/config.php` reads `.env` from the repository root. Blank lines and lines beginning with `#` are skipped. Each other line is split at its first `=`. All five required constants must exist and contain a non-empty value.

| Name | Type | Default | Effect |
|---|---|---|---|
| `DB_HOST` | String | None | PDO MySQL host |
| `DB_USER` | String | None | Database account |
| `DB_PASS` | String | None | Database password |
| `DB_NAME` | String | None | Database and the suffix of the named feed lock |
| `TOKEN_SALT` | Secret string | None | HMAC key for tokens and salt for address hashing |

`.env.example` contains the names with empty values. Requests stop before opening the database when any required value is absent or empty. Values cannot contain an unescaped newline; leading and trailing whitespace around names and values is removed by `trim()`.

Generate `TOKEN_SALT` with a cryptographically secure tool, for example:

```bash
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

---

## Database Configuration

`includes/db.php` builds a MySQL PDO connection from the five constants, enables exceptions, associative fetches and native prepared statements, sets `utf8mb4`, and fixes the session time zone to UTC. `schema.sql` creates every required InnoDB table with `CREATE TABLE IF NOT EXISTS`.

The database account needs ordinary CRUD privileges on its database and permission to call `GET_LOCK()` and `RELEASE_LOCK()`.

---

## Repository Placeholders

The repository deliberately carries neutral values. Replace them in the deployment stage, not in the public source.

| File | Setting | Repository value | Required deployment value |
|---|---|---|---|
| `index.html` | `og:url` | `https://your-deployment-url.com` | Public HTTPS address |
| `index.html` | `og:site_name` | `your-site-name` | Public site name |
| `index.html` | `og:image` | Placeholder host plus `/F1.png` | Absolute icon address |
| `index.html` | `twitter:url` | Placeholder address | Public HTTPS address |
| `index.html` | `twitter:image` | Placeholder icon address | Absolute icon address |
| `app/config/identities.js` | `user-a` display name | `Alpha` | First chosen display name |
| `app/config/identities.js` | `user-b` display name | `Bravo` | Second chosen display name |

The internal identity values remain `user-a` and `user-b`. The page and manifest remain F1 Dashboard, and the chat header remains The Bunker.

---

## Fixed Runtime Limits

These values are constants in the implementation rather than settings:

| Limit | Value | Source |
|---|---:|---|
| Failed entries before lock | 3 | `api/auth.php` |
| Lock duration | 24 hours | `api/auth.php` |
| JSON request read | 256 KiB | `includes/chat.php:readJsonBody()` |
| Default and maximum page | 50 and 100 | `includes/chat.php:boundedLimit()` |
| Feed events per poll | 200 | `api/messages.php` |
| Message body | 60,000 bytes | `api/messages.php` |
| Attachments per message | 20 | `api/messages.php` |
| Edit and delete window | 120 seconds | `api/messages.php` |
| Upload chunk | 1 MiB | `includes/uploads.php` |
| Upload free-space reserve | 50 MiB | `api/upload_init.php` |
| Stale upload age | 24 hours | `includes/uploads.php` |
| Preview response | 512 KiB | `includes/preview.php` |
| Preview redirects | 3 | `includes/preview.php` |
| Visible and hidden polls | 4 and 30 seconds | `app/chat/feed.js` |
| Poll backoff ceiling | 60 seconds | `app/chat/feed.js` |
| Presence threshold | 15 seconds | `app/chat/presence.js` |
| Rendered message window | 100 | `app/chat/messageList.js` |
| Video thumbnail ceiling | 25 MiB | `app/chat/media.js` |

Changing one requires reviewing the corresponding client, endpoint, tests and operational resource limits.

---

## Gate Variables

| Name | Default | Purpose |
|---|---|---|
| `MIRAGE_MYSQL_SOCKET` | None | Unix socket for the disposable gate database |
| `MIRAGE_MYSQL_ADMIN_USER` | `root` | Administrative account used to create the gate database |
| `MIRAGE_BROWSER_TOOLS` | None | Directory containing the external Playwright package |
| `MIRAGE_CHROMIUM` | Playwright discovery | Explicit Chromium executable |
| `MIRAGE_GATE_SHOTS` | Disabled | Directory for optional browser-gate screenshots |

These variables belong to verification only and are never read by the application.

---

## Invalid Configuration

- Missing or empty server variables throw a runtime exception before a query runs.
- Wrong database details become a logged server exception and a generic HTTP 500 response.
- Missing Apache modules break routing or response headers and must fail deployment verification.
- A missing writable `uploads/` directory prevents upload initiation or completion.
- Placeholder metadata remains functional but publishes incorrect social-card addresses.

---

<div align="center">
<br>

**_Architected by Nauman Shahid_**

<br>

[![Portfolio](https://img.shields.io/badge/Portfolio-nauman.cc-000000?style=for-the-badge&logo=googlechrome&logoColor=white)](https://www.nauman.cc)
[![GitHub](https://img.shields.io/badge/GitHub-nshah1d-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/nshah1d)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/nshah1d/)

</div>
<br>

Licensed under the [MIT Licence](../LICENSE). Bundled Inter and JetBrains Mono fonts are licensed under the SIL Open Font License 1.1: [Inter licence](../app/fonts/Inter-LICENSE.txt) and [JetBrains Mono licence](../app/fonts/JetBrainsMono-LICENSE.txt).
