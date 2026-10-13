'use strict';
// Quantified SD&A — tiny live voting server. No dependencies: node:http + node:sqlite.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const PRESENTER_KEY = process.env.PRESENTER_KEY || 'backstage-7k2';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'wotc.db');
const DEFAULT_PROMPT = 'A number on your mind, about you';
const MAX_ENTRIES = 5000;
const MAX_BODY = 10 * 1024;

const DEMO = [[7,'hours slept',12],[3,'coffees so far',9],[2,'coffees',15],[6.5,'sleep, not enough',8],[4,'mood out of 5',10],[12,'browser tabs open',20],[37,'unread emails',14],[1,'meetings left today',11],[5,'days until vacation',18],[8,'km cycled to work',9],[0,'bugs fixed today',7],[2,'times the kids woke me',13],[214,'unread slack messages',25],[9,'plants on my desk',12],[3,'broken dashboards',16],[15,'minutes late to standup',10],[4,'mood out of 5',6],[6,'hours slept',11],[22,'open pull requests',19],[1,'coffee, decaf',8]];

// ---------- storage ----------

if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    revealed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id),
    value REAL NOT NULL,
    descr TEXT NOT NULL DEFAULT '',
    guess REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS entries_round ON entries(round_id);
`);

const q = {
  current: db.prepare('SELECT id, prompt, revealed FROM rounds ORDER BY rowid DESC LIMIT 1'),
  insertRound: db.prepare('INSERT INTO rounds (id, prompt, revealed, created_at) VALUES (?, ?, 0, ?)'),
  setPrompt: db.prepare('UPDATE rounds SET prompt = ? WHERE id = ?'),
  setRevealed: db.prepare('UPDATE rounds SET revealed = ? WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM entries WHERE round_id = ?'),
  // Ordered by value so the list leaks nothing about who submitted when.
  entries: db.prepare('SELECT id, value, descr AS desc, guess FROM entries WHERE round_id = ? ORDER BY value, id'),
  insertEntry: db.prepare('INSERT INTO entries (id, round_id, value, descr, guess, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
};

const newId = n => crypto.randomBytes(n).toString('base64url').slice(0, n);

function currentRound() {
  return q.current.get() || startRound(DEFAULT_PROMPT, process.env.SEED_DEMO === '1');
}

function startRound(prompt, withDemo) {
  const id = newId(8), now = Date.now();
  db.exec('BEGIN');
  try {
    q.insertRound.run(id, prompt, now);
    if (withDemo) DEMO.forEach(([v, d, g], i) => q.insertEntry.run(id + '-d' + i, id, v, d, g, now));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return q.current.get();
}

function publicState() {
  const r = currentRound();
  const revealed = !!r.revealed;
  const state = { id: r.id, prompt: r.prompt, revealed, count: q.count.get(r.id).n };
  // Numbers stay sealed in the box until the reveal; before that only the count is public.
  if (revealed) state.entries = q.entries.all(r.id);
  return state;
}

// ---------- live updates (SSE) ----------

const clients = new Set();
function broadcast() {
  const msg = 'data: ' + JSON.stringify(publicState()) + '\n\n';
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// ---------- http helpers ----------

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
function isPresenter(req) {
  return crypto.timingSafeEqual(sha(req.headers['x-presenter-key'] || ''), sha(PRESENTER_KEY));
}

const num = x => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e12 ? x : null);

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

// ---------- routes ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const route = req.method + ' ' + url.pathname;

  if (req.method === 'GET' && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(__dirname, 'public', file)).pipe(res);
  }

  switch (route) {
    case 'GET /api/round':
      return send(res, 200, publicState());

    case 'GET /api/events': {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\ndata: ' + JSON.stringify(publicState()) + '\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    case 'POST /api/entries': {
      const b = await readJson(req);
      const value = num(b.value), guess = num(b.guess);
      if (value == null || guess == null) return send(res, 400, { error: 'value and guess must be numbers' });
      const desc = typeof b.desc === 'string' ? b.desc.trim().slice(0, 60) : '';
      const r = currentRound();
      if (b.round && b.round !== r.id) return send(res, 409, { error: 'round changed', state: publicState() });
      if (r.revealed) return send(res, 409, { error: 'the box is closed', state: publicState() });
      if (q.count.get(r.id).n >= MAX_ENTRIES) return send(res, 429, { error: 'the box is full' });
      const id = newId(10);
      q.insertEntry.run(id, r.id, value, desc, guess, Date.now());
      broadcast();
      return send(res, 201, { id, round: r.id });
    }

    case 'GET /api/presenter':
      return send(res, isPresenter(req) ? 200 : 403, { ok: isPresenter(req) });

    case 'PATCH /api/round': {
      if (!isPresenter(req)) return send(res, 403, { error: 'forbidden' });
      const b = await readJson(req), r = currentRound();
      if (typeof b.prompt === 'string') q.setPrompt.run(b.prompt.slice(0, 200), r.id);
      if (typeof b.revealed === 'boolean') q.setRevealed.run(b.revealed ? 1 : 0, r.id);
      broadcast();
      return send(res, 200, publicState());
    }

    case 'POST /api/round': {
      // New round (optionally filled with the demo crowd). The prompt carries over.
      if (!isPresenter(req)) return send(res, 403, { error: 'forbidden' });
      const b = await readJson(req);
      startRound(currentRound().prompt, b.demo === true);
      broadcast();
      return send(res, 201, publicState());
    }
  }

  send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'server error' });
    if (!err.status) console.error(err);
  });
});

if (require.main === module) {
  currentRound();
  server.listen(PORT, () => {
    console.log(`Quantified SD&A on http://localhost:${PORT}`);
    console.log(`Presenter view:  http://localhost:${PORT}/#${PRESENTER_KEY}`);
  });
}

module.exports = { server };
