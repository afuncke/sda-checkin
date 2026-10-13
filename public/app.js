'use strict';
// Quantified SD&A — client. Vote view by default; presenter view at /#<presenter key>.

const BINS = 8; // histogram bars (3–20)
const ME_KEY = 'wotc-me';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let round = null;
const ui = { view: 'vote', key: '', step: 1, value: '', desc: '', guess: '', hideOutlier: false, busy: false, error: '' };

// ---------- helpers (same maths as the design prototype) ----------

const num = s => { const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = n => { if (n == null || !isFinite(n)) return '–'; return Math.abs(n) >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString(); };
const nice = x => { const p = Math.pow(10, Math.floor(Math.log10(x))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cleanNum = s => s.replace(/[^0-9.,\-]/g, '');

function loadMe() { try { return JSON.parse(localStorage.getItem(ME_KEY)) || null; } catch { return null; } }
function saveMe(me) { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch {} }

function wordsFrom(entries) {
  const stop = new Set('a an the of my i me to in on at for and or so far today is it this that with not too per out am are was be by from up down how many much times time number numbers just'.split(' '));
  const c = {};
  entries.forEach(e => (e.desc || '').toLowerCase().replace(/[^a-zà-ÿ0-9\s'-]/g, ' ').split(/\s+/).forEach(w => { if (w.length > 2 && !stop.has(w)) c[w] = (c[w] || 0) + 1; }));
  const list = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 30);
  if (!list.length) return [];
  const max = list[0][1];
  const colors = ['#0B4FA8', '#141414', '#0B4FA8', '#8A6A00', '#141414'];
  const out = list.map(([t, n], i) => { const k = max > 1 ? (n - 1) / (max - 1) : 1; return { text: t, size: Math.round(16 + k * 40), weight: k > 0.5 ? 900 : k > 0.2 ? 800 : 600, color: colors[i % colors.length] }; });
  return out.sort((a, b) => (a.text.charCodeAt(1) % 7) - (b.text.charCodeAt(1) % 7));
}

// ---------- server ----------

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (ui.key) headers['X-Presenter-Key'] = ui.key;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  return data;
}

function setRound(r) {
  if (round && r.id !== round.id) Object.assign(ui, { step: 1, value: '', desc: '', guess: '', hideOutlier: false, error: '' });
  round = r;
  render();
}

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = e => setRound(JSON.parse(e.data));
  // EventSource reconnects on its own; refetch on return to the tab in case a phone slept.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) api('GET', '/api/round').then(setRound).catch(() => {}); });
}

async function checkView() {
  const key = decodeURIComponent(location.hash.slice(1));
  let view = 'vote';
  if (key) {
    ui.key = key;
    try { await api('GET', '/api/presenter'); view = 'present'; } catch { ui.key = ''; }
  } else ui.key = '';
  ui.view = view;
  render();
}

// ---------- vote actions ----------

const v = () => num(ui.value), g = () => num(ui.guess);
function goStep(n) {
  const forward = n > ui.step;
  ui.step = n; ui.error = '';
  render();
  // Keep the keyboard up when moving forward; don't pop it when stepping back.
  if (forward) $({ 2: 'desc', 3: 'guess' }[n]).focus({ preventScroll: true });
}
function bump(d) {
  ui.value = String(Math.round(((v() ?? 0) + d) * 10) / 10);
  $('value').value = ui.value;
  render();
}

async function submitEntry() {
  if (v() == null || g() == null || ui.busy || !round) return;
  ui.busy = true; ui.error = ''; render();
  try {
    const r = await api('POST', '/api/entries', { round: round.id, value: v(), desc: ui.desc.trim(), guess: g() });
    saveMe({ round: r.round, id: r.id, value: v(), guess: g() });
    Object.assign(ui, { step: 1, value: '', desc: '', guess: '' });
  } catch (e) {
    if (e.data && e.data.state) setRound(e.data.state);
    else ui.error = 'Couldn’t reach the box. Check your connection and try again.';
  } finally {
    ui.busy = false;
    render();
  }
}

// ---------- presenter actions ----------

let promptTimer = null;
function presenterAction(p) { p.then(setRound).catch(e => { if (e.status === 403) checkView(); else console.error(e); }); }

// ---------- render ----------

function render() {
  const isVote = ui.view === 'vote';
  $('vote').hidden = !isVote;
  $('present').hidden = isVote;
  if (!round) return;
  if (isVote) renderVote(); else renderPresent();
}

function renderVote() {
  const me = loadMe();
  const mine = me && me.round === round.id ? me : null;
  const submitted = !!mine, closed = !mine && round.revealed, voting = !mine && !round.revealed;

  $('vote-prompt').textContent = round.prompt;

  $('steps').hidden = !voting;
  const steps = $('steps'); steps.replaceChildren();
  [1, 2, 3].forEach(k => {
    const s = el('div', 'step'); s.style.flex = k < 3 ? '1' : 'none';
    const d = el('div', 'dot', k);
    d.style.background = k < ui.step ? '#141414' : k === ui.step ? '#FFD23F' : '#FFFFFF';
    d.style.color = k < ui.step ? '#FFD23F' : '#141414';
    s.append(d);
    if (k < 3) { const l = el('div', 'step-line'); l.style.opacity = k < ui.step ? 1 : 0.2; s.append(l); }
    steps.append(s);
  });

  $('step1').hidden = !(voting && ui.step === 1);
  $('step2').hidden = !(voting && ui.step === 2);
  $('step3').hidden = !(voting && ui.step === 3);
  for (const k of ['value', 'desc', 'guess']) if ($(k).value !== ui[k]) $(k).value = ui[k];
  $('next1').disabled = v() == null;
  $('value-echo').textContent = ui.value;
  $('submit').disabled = g() == null || ui.busy;
  $('submit-error').hidden = !ui.error;
  $('submit-error').textContent = ui.error;

  $('submitted').hidden = !submitted;
  if (mine) { $('my-value').textContent = fmt(mine.value); $('my-guess').textContent = fmt(mine.guess); }
  $('closed').hidden = !closed;
}

function renderPresent() {
  const r = round, entries = r.entries || [];
  const pi = $('prompt-input');
  if (document.activeElement !== pi && pi.value !== r.prompt) pi.value = r.prompt;

  const rv = $('reveal');
  rv.textContent = r.revealed ? 'Hide results' : 'Reveal';
  rv.style.background = r.revealed ? '#141414' : '#FFD23F';
  rv.style.color = r.revealed ? '#FFFFFF' : '#141414';

  $('waiting').hidden = r.revealed;
  $('results').hidden = !r.revealed;

  if (!r.revealed) {
    $('count').textContent = r.count;
    $('count-label').textContent = r.count === 1 ? 'number' : 'numbers';
    const chips = $('chips');
    while (chips.children.length < r.count) chips.append(el('div', 'chip'));
    while (chips.children.length > r.count) chips.lastChild.remove();
    return;
  }

  // Outlier: robust z-score against the median absolute deviation.
  const vals = entries.map(e => e.value), med = median(vals);
  let outlier = null;
  if (entries.length >= 4) {
    const mad = median(vals.map(x => Math.abs(x - med))) || 1;
    entries.forEach(e => { const z = Math.abs(e.value - med) / mad; if (z > 6 && (!outlier || z > outlier.z)) outlier = { ...e, z }; });
  }
  const shown = ui.hideOutlier && outlier ? entries.filter(e => e.id !== outlier.id) : entries;
  const rvals = shown.map(e => e.value), gvals = shown.map(e => e.guess);
  const realMean = mean(vals), guessMean = mean(entries.map(e => e.guess));

  // Shared bins for real numbers and guesses.
  const nb = Math.max(3, Math.min(20, BINS));
  const all = [...rvals, ...gvals];
  let lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 10;
  if (hi === lo) hi = lo + 1;
  const step = nice((hi - lo) / nb), start = Math.floor(lo / step) * step;
  const n = Math.max(1, Math.floor((hi - start) / step) + 1), end = start + n * step;
  const bins = Array.from({ length: n }, (_, i) => ({ a: start + i * step, b: start + (i + 1) * step, r: 0, g: 0 }));
  const idx = x => Math.min(n - 1, Math.max(0, Math.floor((x - start) / step)));
  rvals.forEach(x => bins[idx(x)].r++); gvals.forEach(x => bins[idx(x)].g++);
  const maxC = Math.max(1, ...bins.map(b => Math.max(b.r, b.g)));
  const pos = x => Math.max(0, Math.min(100, ((x - start) / (end - start)) * 100));
  const sm = mean(rvals), sg = mean(gvals);

  const err = realMean ? (guessMean - realMean) / Math.abs(realMean) : 0;
  const ae = Math.abs(err);
  const verdict = !entries.length ? 'No numbers yet.'
    : ae < 0.1 ? 'The crowd nailed it. Collectively, we know ourselves.'
    : ae < 0.3 ? (err < 0 ? 'Close. The crowd guessed a little low.' : 'Close. The crowd guessed a little high.')
    : (err < 0 ? 'The crowd underestimated us by a lot.' : 'The crowd overestimated us by a lot.') + (outlier ? ' One number may have something to do with it.' : '');

  $('real-mean').textContent = fmt(realMean);
  $('guess-mean').textContent = fmt(guessMean);
  $('err-pct').textContent = entries.length ? Math.round(ae * 100) + '%' : '–';
  $('real-median').textContent = fmt(med);
  $('verdict').textContent = verdict;

  // Histogram — reuse bar nodes so heights animate between renders.
  const binsEl = $('bins');
  while (binsEl.children.length < n) {
    const b = el('div', 'bin');
    b.append(el('div', 'bar real'), el('div', 'bar guess'));
    b.firstChild.append(el('div', 'bar-label')); b.lastChild.append(el('div', 'bar-label'));
    binsEl.append(b);
  }
  while (binsEl.children.length > n) binsEl.lastChild.remove();
  const axis = $('axis'); axis.replaceChildren();
  bins.forEach((b, i) => {
    const [real, guess] = binsEl.children[i].children;
    real.style.height = (b.r / maxC) * 88 + '%'; real.firstChild.textContent = b.r || '';
    guess.style.height = (b.g / maxC) * 88 + '%'; guess.firstChild.textContent = b.g || '';
    guess.style.borderWidth = b.g ? '' : '0'; // no stray 2px stub for empty bins
    axis.append(el('div', null, fmt(b.a) + '–' + fmt(b.b)));
  });
  $('real-line').style.left = (sm == null ? 0 : pos(sm)) + '%';
  $('guess-line').style.left = (sg == null ? 0 : pos(sg)) + '%';
  $('real-line-label').textContent = fmt(realMean);
  $('guess-line-label').textContent = fmt(guessMean);

  const to = $('toggle-outlier');
  to.hidden = !outlier;
  to.textContent = ui.hideOutlier ? 'Show outlier' : 'Hide outlier in chart';
  $('outlier').hidden = !outlier;
  if (outlier) {
    $('outlier-value').textContent = fmt(outlier.value);
    $('outlier-desc').textContent = outlier.desc ? '“' + outlier.desc + '”' : 'No explanation given.';
  }

  const words = wordsFrom(entries), cloud = $('cloud');
  cloud.replaceChildren(...(words.length
    ? words.map(w => { const s = el('span', null, w.text); Object.assign(s.style, { fontSize: w.size + 'px', fontWeight: w.weight, color: w.color }); return s; })
    : [el('span', 'empty', 'Nobody described their number this time.')]));
}

// ---------- wiring ----------

for (const k of ['value', 'guess']) $(k).addEventListener('input', e => {
  const c = cleanNum(e.target.value);
  if (c !== e.target.value) e.target.value = c;
  ui[k] = c; ui.error = ''; render();
});
$('desc').addEventListener('input', e => { ui.desc = e.target.value; });
$('inc').addEventListener('click', () => bump(1));
$('dec').addEventListener('click', () => bump(-1));
$('step1').addEventListener('submit', e => { e.preventDefault(); if (v() != null) goStep(2); });
$('step2').addEventListener('submit', e => { e.preventDefault(); goStep(3); });
$('step3').addEventListener('submit', e => { e.preventDefault(); submitEntry(); });
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => goStep(Math.max(1, ui.step - 1))));

$('prompt-input').addEventListener('input', e => {
  const prompt = e.target.value;
  clearTimeout(promptTimer);
  promptTimer = setTimeout(() => presenterAction(api('PATCH', '/api/round', { prompt })), 300);
});
$('prompt-input').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('reveal').addEventListener('click', () => presenterAction(api('PATCH', '/api/round', { revealed: !round.revealed })));
$('new-round').addEventListener('click', () => presenterAction(api('POST', '/api/round', {})));
$('demo').addEventListener('click', () => presenterAction(api('POST', '/api/round', { demo: true })));
$('toggle-outlier').addEventListener('click', () => { ui.hideOutlier = !ui.hideOutlier; render(); });

window.addEventListener('hashchange', checkView);
checkView();
connect();
