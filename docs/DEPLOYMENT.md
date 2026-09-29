# Covert Messenger Deployment

Covert Messenger is served directly from the repository files. There is no compilation, bundling or runtime dependency installation.

---

## Deployment Model

Use Apache with HTTPS, PHP 8 and a MySQL database. The repository root becomes the document root. Public metadata and identity display names are written into a separate staging copy so the repository retains its placeholders.

Do not deploy repository documentation, tests, `schema.sql` or `package.json`. Apache denies them when present, but omission keeps the served surface smaller.

---

## Initial Provisioning

1. Create an empty MySQL database and a least-privilege account for it.
2. Load `schema.sql`.
3. Copy `.env.example` to `.env` and set all five values described in [CONFIGURATION.md](CONFIGURATION.md).
4. Create `uploads/`, copy `uploads/.htaccess` into it and grant the PHP process read and write access.
5. Enable Apache `mod_rewrite` and `mod_headers`.
6. Configure a trusted TLS certificate and point the virtual host at the staged web root.

The server layout is:

```text
web-root/
├── app/
├── api/
├── includes/
├── uploads/
│   └── .htaccess
├── .env
├── .htaccess
├── F1.png
├── index.html
├── manifest.json
├── robots.txt
└── sw.js
```

---

## Prepare the Stage

Copy the served source into a temporary staging directory:

- `app/`
- `api/`
- `includes/`
- `index.html`
- `sw.js`
- `manifest.json`
- `F1.png`
- `robots.txt`
- `.htaccess`
- `uploads/.htaccess`

Set the five Open Graph and Twitter address fields in staged `index.html`. Set the two display names in staged `app/config/identities.js`. Keep `.env` and all stored uploads outside the stage.

---

## Deploy

1. Run the unit, PHP and browser gates against the release source.
2. Back up the currently served application files and record the object count and byte size of `uploads/`.
3. Apply any new `CREATE TABLE IF NOT EXISTS` statements from `schema.sql` before deploying PHP that uses them.
4. Copy changed shared PHP files before their endpoints, imported browser modules before their importers, and `index.html` and `sw.js` last.
5. Remove obsolete application files only by exact name.
6. Preserve the existing `.env`, `uploads/` contents and database.

Avoid directory synchronisation or broad deletion against a live installation. User uploads and secrets are server state, not release artefacts.

---

## Apache Contract

The shipped `.htaccess`:

- redirects HTTP to HTTPS;
- forwards the Authorization header to PHP under CGI or FastCGI;
- blocks direct requests for `includes/`, `uploads/`, `tests/` and `docs/`;
- blocks dotfiles, Markdown, `schema.sql` and `package.json`;
- sends unknown non-API paths to `index.html`;
- applies CSP and the other security headers;
- requires scripts, styles, HTML and JSON to revalidate.

Unknown API paths remain ordinary 404 responses.

---

## Local Verification

The unit suite requires only Node.js:

```bash
npm test
```

The integration gates require a disposable MySQL socket:

```bash
MIRAGE_MYSQL_SOCKET=/path/to/mysql.sock node tests/php_gate.mjs
MIRAGE_MYSQL_SOCKET=/path/to/mysql.sock \
MIRAGE_BROWSER_TOOLS=/path/to/playwright \
node tests/browser_gate.mjs
```

The PHP gate starts the built-in PHP server through `tests/router.php` and exercises the real endpoints. The browser gate drives Chromium with the shipped response headers and recorded F1 provider fixtures.

---

## Production Verification

After copying the release:

1. Compare every deployed application file with the stage byte for byte.
2. Confirm the main page returns HTTP 200 over HTTPS.
3. Confirm `/.env`, `/includes/`, `/uploads/`, `/tests/` and `/docs/` are refused.
4. Confirm an unauthenticated request to `/api/messages.php?initial=1` returns HTTP 401.
5. Confirm CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Robots-Tag` and `Permissions-Policy` are present.
6. Load the dashboard, change seasons and open each view without console errors.
7. Confirm entry and messaging with both identities, including an attachment and exit on page hiding.
8. Confirm the upload object count and byte size did not change during deployment.

---

## Updating an Existing Installation

Treat `schema.sql` as additive. Apply new table creation before new application code. Do not drop or alter an existing table merely because a clean installation definition differs; plan migrations explicitly.

The service worker fetches the network first and application assets carry `no-cache`, so a normal reload revalidates the release. Changing `CACHE_NAME` in `sw.js` removes older named caches on activation.

---

## Rollback

Restore only the application files changed by the release, using the pre-deployment backup. Delete newly introduced application files by exact name. Leave additive database tables in place for the earlier code to ignore. Never roll back `.env` or `uploads/` from an application-file backup.

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
