# Covert Messenger

![JavaScript](https://img.shields.io/badge/JavaScript-ES2020+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![PHP](https://img.shields.io/badge/PHP-8.0+-777BB4?style=for-the-badge&logo=php&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Zero Dependencies](https://img.shields.io/badge/Runtime_Dependencies-Zero-4FC08D?style=for-the-badge)
![Licence](https://img.shields.io/badge/Licence-MIT_%2B_OFL_1.1-0078D4?style=for-the-badge)

Covert Messenger is a two-person web messenger concealed behind a complete Formula 1 dashboard. The public page and installed application are named **F1 Dashboard**; the chat header is **The Bunker**. Both layers run at one address without a framework, bundler or runtime package dependency.

The dashboard provides current and historical schedules, standings, race-weekend results and driver comparisons from Jolpica and OpenF1. A hidden gesture accepts one of two published date formats and opens the messenger. That date key is a showcase gate, not a security layer.

---

## What It Does

- Shows championship overviews, driver and constructor standings, race-weekend sessions and head-to-head driver comparisons across six seasons.
- Caches Formula 1 responses in memory, spaces requests per host and distinguishes empty data, provider failures and rate limits.
- Exchanges text, Markdown, replies, six emoji reactions and attachments between two identities.
- Keeps both screens current through an ordered change feed with idempotent sends, paged history, search, context jumps and presence.
- Uploads files in checked 1 MiB chunks, serves authenticated media and previews images, video, audio, PDF, Markdown and text.
- Keeps the session in `sessionStorage`, exits when the page is hidden and excludes API responses from the service-worker cache.

---

## Architecture

`index.html` loads plain ES modules. `app/main.js` mounts either the Formula 1 dashboard or The Bunker into one root element. PHP endpoints under `api/` use shared code under `includes/` and persist chat state in MySQL. A named database lock serialises mutations before writing the event feed.

Full architecture reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Requirements

Runtime requirements:

- PHP 8.0 or later with PDO MySQL and cURL.
- MySQL 8.0 or MariaDB with InnoDB and named-lock support.
- Apache with `mod_rewrite` and `mod_headers`.
- HTTPS for hosted deployments.

Development and verification require Node.js. The repository does not declare a minimum Node.js version. The PHP and browser gates also require a disposable MySQL database; the browser gate requires Chromium and Playwright supplied through `MIRAGE_BROWSER_TOOLS`.

---

## Quick Start

1. Clone the repository and enter it.
2. Create an empty database and load `schema.sql`.
3. Copy `.env.example` to `.env`, then set `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` and a long random `TOKEN_SALT`.
4. Replace the Open Graph placeholders in `index.html` and the `Alpha` and `Bravo` display names in `app/config/identities.js` in the deployment copy.
5. Ensure `uploads/` is writable by PHP and retains `uploads/.htaccess`.
6. For local use, start PHP's built-in server from the repository root. The configured MySQL database and `.env` are still required:

```bash
php -S localhost:8080 -t . tests/router.php
```

7. Open `http://localhost:8080/`. `app/main.js` permits HTTP on `localhost`, and `tests/router.php` reproduces the shipped Apache routing, access denials, content types and gate-supplied response headers.
8. For hosted use, serve the staged web root through Apache over HTTPS.

```text
web-root/
├── app/
├── api/
├── includes/
├── uploads/
├── .env
├── .htaccess
├── F1.png
├── index.html
├── manifest.json
├── robots.txt
└── sw.js
```

Desktop entry begins by clicking an empty dashboard background and typing the date key. Mobile entry begins with five quick taps on the F1 Dashboard logo. `DDMMYYYY` selects `user-a`; `YYYYMMDD` selects `user-b`. The current date and the date one hour earlier are accepted in the browser's time zone.

```bash
npm test
MIRAGE_MYSQL_SOCKET=/path/to/mysql.sock node tests/php_gate.mjs
MIRAGE_MYSQL_SOCKET=/path/to/mysql.sock \
MIRAGE_BROWSER_TOOLS=/path/to/playwright \
node tests/browser_gate.mjs
```

---

## Directory Layout

```text
app/                 browser application, local fonts and styles
api/                 authenticated PHP endpoints and configuration loader
includes/            database, authentication, feed, preview and upload helpers
uploads/             stored attachments and temporary upload chunks
tests/               unit, PHP and Chromium gates with recorded F1 fixtures
docs/                engineering, configuration and deployment references
index.html           page shell and deployment metadata placeholders
sw.js                network-first same-origin shell cache
manifest.json        F1 Dashboard install metadata
schema.sql           complete database schema
.env.example         required secret and database setting names
.htaccess            HTTPS, routing, access controls and response headers
package.json         test commands; no runtime dependencies
```

---

## The Cover

The dashboard contains Overview, Standings, Race Centre and Head to Head views, six season choices and an About card. An empty season has its own message; a busy or failed provider has a distinct error state with Retry. Its page title, manifest and install name remain F1 Dashboard. The Bunker replaces it only after entry, without changing the address.

The date patterns are deliberately visible in the source. Deployments requiring secret authentication must replace the entry model rather than describe the date key as protection.

---

## Configuration

Server secrets live in `.env`. Deployment-specific public metadata lives in `index.html`, and the two chat display names live in `app/config/identities.js`. Internal identifiers such as `mirage_feed_`, the `mirage:` log prefix, the `MIRAGE_` gate variables and the `f1-dashboard` package name remain unchanged.

Full configuration reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

---

## Deployment

There is no build step. Deploy the served files to an Apache web root, apply `schema.sql`, provision `.env`, preserve the writable `uploads/` directory and verify the access-denial rules before use. Replace repository placeholders only in a staging copy for each deployment.

Full deployment reference: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## Security

The application binds stateless HMAC tokens to a browser fingerprint, rate-limits entry attempts, protects mutations with a per-login nonce, validates upload ownership and file types, constrains link-preview requests and denies direct access to secrets, server code and uploads. Messages and attachments remain readable by the database and host operator and are not end-to-end encrypted.

Full security reference: [SECURITY.md](SECURITY.md)

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
