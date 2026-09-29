import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import net from 'node:net';

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SITE_ENTRIES = ['index.html', 'app', 'api', 'includes', 'manifest.json', 'sw.js', 'F1.png', 'robots.txt', 'schema.sql'];

export function mysqlAdmin(sql, database) {
  const socket = process.env.MIRAGE_MYSQL_SOCKET;
  if (!socket) throw new Error('MIRAGE_MYSQL_SOCKET is not set');
  const args = ['--no-defaults', `--socket=${socket}`, `--user=${process.env.MIRAGE_MYSQL_ADMIN_USER || 'root'}`, '--batch', '--skip-column-names'];
  if (database) args.push(database);
  return execFileSync('mysql', args, { input: sql, encoding: 'utf8' }).trim();
}

export function securityHeaders() {
  const htaccess = readFileSync(join(PROJECT, '.htaccess'), 'utf8');
  const headers = {};
  for (const match of htaccess.matchAll(/^\s*Header always set ([A-Za-z-]+) "((?:[^"\\]|\\.)*)"/gm)) {
    headers[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return headers;
}

async function freePort() {
  return new Promise((ok, fail) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
    server.on('error', fail);
  });
}

export async function startSite() {
  const database = `mirage_gate_${randomBytes(4).toString('hex')}`;
  const user = `gate_${randomBytes(3).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  const salt = randomBytes(32).toString('hex');

  mysqlAdmin(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '${user}'@'localhost' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'localhost';`);
  mysqlAdmin(readFileSync(join(PROJECT, 'schema.sql'), 'utf8'), database);

  const root = mkdtempSync(join(tmpdir(), 'mirage-site-'));
  for (const entry of SITE_ENTRIES) {
    if (existsSync(join(PROJECT, entry))) cpSync(join(PROJECT, entry), join(root, entry), { recursive: true });
  }
  mkdirSync(join(root, 'uploads'), { recursive: true });
  writeFileSync(join(root, '.env'), `DB_HOST=localhost\nDB_USER=${user}\nDB_PASS=${password}\nDB_NAME=${database}\nTOKEN_SALT=${salt}\n`);

  const port = await freePort();
  const php = spawn('php', [
    '-d', `pdo_mysql.default_socket=${process.env.MIRAGE_MYSQL_SOCKET}`,
    '-d', 'upload_max_filesize=8M', '-d', 'post_max_size=10M',
    '-S', `127.0.0.1:${port}`, '-t', root, join(PROJECT, 'tests', 'router.php'),
  ], { env: { ...process.env, MIRAGE_GATE_HEADERS: JSON.stringify(securityHeaders()) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  php.stderr.on('data', (chunk) => { log += chunk; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/robots.txt`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  return {
    base, root, database, salt,
    sql: (statement) => mysqlAdmin(statement, database),
    ipHash: (ip) => pbkdf2Sync(ip, salt, 100000, 16, 'sha256').toString('hex'),
    log: () => log,
    async stop() {
      php.kill('SIGTERM');
      try { mysqlAdmin(`DROP DATABASE IF EXISTS ${database}; DROP USER IF EXISTS '${user}'@'localhost';`); } catch {}
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function dateKeys(timeZone, when = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(when).map((p) => [p.type, p.value]));
  return { alpha: `${parts.day}${parts.month}${parts.year}`, bravo: `${parts.year}${parts.month}${parts.day}` };
}
