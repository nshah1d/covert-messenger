# Covert Messenger Security

Covert Messenger combines concealment, short-lived browser state and authenticated server requests. The published date key is a showcase gate. It is visible in `api/auth.php` and must never be treated as a secret or a substitute for account authentication.

---

## Threat Model

The cover reduces accidental discovery on a shared screen: the initial view is a working Formula 1 dashboard, the address stays at `/`, no chat control is visible, and hiding the page exits the chat. The design assumes control of the host, database and TLS endpoint. It does not protect data from the server operator, a database compromise, filesystem access or an attacker who knows the date-key scheme.

Messages are stored as plaintext in MySQL. Attachments are stored as files under `uploads/`. The application is not end-to-end encrypted.

---

## Trust Boundaries

| Boundary | Implemented control | Source |
|---|---|---|
| Browser to entry endpoint | HTTPS guard, fingerprint format, per-address lockout | `app/main.js`, `api/auth.php` |
| Browser to chat API | Bearer HMAC and fingerprint on every request | `app/lib/api.js`, `includes/auth_check.php` |
| Mutation ownership | Identity from token; login nonce for edits and deletions | `api/messages.php` |
| Concurrent writers | Named MySQL lock, transaction and ordered event rows | `includes/chat.php:withFeedLock()` |
| Upload staging | Random identifier, identity manifest, exact chunk lengths | `includes/uploads.php`, `api/upload_chunk.php` |
| Stored media | Random stored name, blocked extensions and detected types | `api/upload_complete.php` |
| Media delivery | Token required, path confinement, restricted inline types | `api/media.php` |
| Remote preview fetch | Public IPv4 only, pinned DNS result and checked redirects | `includes/preview.php` |
| Public web root | Direct-access denials and response headers | `.htaccess`, `uploads/.htaccess` |

---

## Entry, Tokens and Lockout

`api/auth.php` accepts `DDMMYYYY` for `user-a` and `YYYYMMDD` for `user-b`, using the supplied browser time zone with UTC as fallback. The current date and the date one hour earlier are accepted. A successful entry returns an HMAC-SHA256 token over the browser fingerprint, UTC date and identity, plus a random 64-hex nonce.

`includes/auth_check.php` re-derives candidates for both identities using the current and previous UTC dates and compares them with `hash_equals()`. Tokens are stateless, cannot be revoked individually and can remain valid until the end of the next UTC day.

The source IP is stored only as a PBKDF2-SHA256 hash using `TOKEN_SALT`, 100,000 iterations and a 32-byte output. Three failures lock the hashed address for 24 hours. The counter resets after success, expiry or one day without an attempt.

---

## Browser State and Caching

`app/lib/api.js` keeps the token, fingerprint, nonce, identity and time zone in `sessionStorage`. Exit, page hiding and authentication expiry clear the session. Media is fetched into object URLs; `app/chat/media.js` revokes them 30 seconds after the final user releases them and revokes all media on exit.

`sw.js` uses network-first caching only for same-origin GET requests outside `/api/`. It never handles chat API requests or credentials. Cached shell assets may remain available offline, but chat data is not cached by the service worker.

---

## Request and Data Integrity

Chat JSON bodies are read to a 256 KiB ceiling. Positive identifiers accept at most 19 decimal digits, and page sizes are clamped from 1 to 100. Message bodies are limited to 60,000 bytes and a message may claim at most 20 attachments.

Each send carries a 32-hex client identifier unique per identity. `message_requests` maps it to the stored message, making retries idempotent. Edits and deletions require the sender identity, the nonce of the login that sent the message and an age of at most 120 seconds. Deletion retains a tombstone and removes attachment files after the transaction commits.

---

## Upload and Media Controls

Uploads use 1 MiB chunks. Initiation requires a positive integer size and at least the declared size plus 50 MiB of free space. Staging identifiers are random 32-hex strings, manifests bind each upload to one identity, and staging older than 24 hours is swept during later initiation.

Completion requires every chunk at its exact expected length. Executable and script extensions are refused, the assembled content type is detected, dangerous detected types are refused, and the stored name is random. This is a deny-list boundary, not malware scanning. Unknown safe types are delivered as downloads with `nosniff`; only listed raster images, video, audio and PDF are served inline. SVG and HTML are downloads.

---

## Link Preview Controls

`includes/preview.php` accepts HTTP and HTTPS on ports 80 and 443 without URL credentials. It resolves a public IPv4 address, pins cURL to that result, rechecks each of at most three redirects, limits the response body to 512 KiB and sets a five-second request timeout. Preview image addresses are returned only when they use HTTPS. The viewer's browser then contacts that image host directly.

---

## Web Server Controls

`.htaccess` redirects HTTP to HTTPS; copies the Authorization header into the CGI/FastCGI environment; refuses direct access to `includes/`, `uploads/`, `tests/`, `docs/`, dotfiles, Markdown, `schema.sql` and `package.json`; and applies CSP, `SAMEORIGIN`, `nosniff`, `no-referrer`, `noindex` and a restrictive permissions policy. `app/main.js` also refuses plain HTTP except on `localhost`.

---

## Residual Risks

- The published date key is predictable and grants entry to anyone who can reach the site and derive it.
- A stateless token has no server-side revocation control.
- The fingerprint distinguishes a browser configuration rather than a person.
- Host and database administrators can read messages and attachments.
- Upload checks do not scan for malware or inspect all possible active-content formats.
- IPv6-only preview hosts fail because preview resolution is deliberately restricted to public IPv4.
- Preview images disclose the viewer's connection to the image host.
- Rate limiting is keyed to the apparent remote address and depends on correct proxy configuration.

---

## Reporting a Vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting in the repository's Security tab. If that route is unavailable, use the contact route at [nauman.cc](https://www.nauman.cc). Do not open a public issue for an undisclosed vulnerability.

Include the affected file and function, the conditions required, the observed consequence and a minimal reproduction where safe. Keep credentials, live configuration and private data out of the report.

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

Licensed under the [MIT Licence](LICENSE). Bundled Inter and JetBrains Mono fonts are licensed under the SIL Open Font License 1.1: [Inter licence](app/fonts/Inter-LICENSE.txt) and [JetBrains Mono licence](app/fonts/JetBrainsMono-LICENSE.txt).
