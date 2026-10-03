// Ende-zu-Ende-Test Lern-Coach: Extension in Chromium gegen den LeetCode-Nachbau und einen
// OpenRouter-Nachbau (lokaler Server, Basis-URL umgestellt).
// Aufruf aus leetcode-debugger/:  NODE_PATH=$(npm root -g) node test/coach-e2e.js [screenshot.png]
// Echtes Monaco: global installiertes monaco-editor (MONACO=<Paketname> wählt eine andere Version).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const { SOLUTION, COMPOSE_DESC, RANSOM, RANSOM_DESC, makePage, makeMonacoPage, monacoRoute } = require('./fake-leetcode.js');

const EXT = path.resolve(__dirname, '..');
const SHOT = process.argv[2];
const PAGE = makePage('Function Composition', COMPOSE_DESC, SOLUTION);

// ---------------------------------------------------------------- OpenRouter-Nachbau

const or = { queue: [], reqs: [], delay: 0 };
const answer = (...texts) => or.queue.push(...texts);
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, http-referer, x-title');
  if (req.method === 'OPTIONS') return res.end();
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let j = null;
    try { j = JSON.parse(body); } catch (e) { /* egal */ }
    or.reqs.push({ url: req.url, headers: req.headers, body: j });
    const next = or.queue.length ? or.queue.shift() : '';
    const send = () => {
      if (next && typeof next === 'object' && next.status) { res.statusCode = next.status; return res.end('{}'); }
      if (next && typeof next === 'object' && next.raw != null) { res.setHeader('Content-Type', 'application/json'); return res.end(next.raw); }
      res.setHeader('Content-Type', 'application/json');
      const content = next && typeof next === 'object' && 'text' in next ? next.text : String(next);
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    };
    const d = (next && next.delay) || or.delay;
    if (d) setTimeout(send, d); else send();
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const OR_BASE = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  const lc = { routes: [monacoRoute(fs, path)] };   // zusätzliche Antworten des LeetCode-Nachbaus
  await ctx.route('https://leetcode.com/**', (route) => {
    const u = route.request().url();
    for (const [re, fn] of lc.routes) if (re.test(u)) return fn(route);
    if (/[?&]monaco=1/.test(u)) {
      const html = /\/problems\/ransom-note\//.test(u) ? makeMonacoPage('Ransom Note', RANSOM_DESC, RANSOM) : makeMonacoPage('Function Composition', COMPOSE_DESC, SOLUTION);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    }
    if (/\/problems\/ransom-note\//.test(u)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: makePage('Ransom Note', RANSOM_DESC, RANSOM) });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const EXT_ID = sw.url().split('/')[2];
  const setCoach = (o) => sw.evaluate((x) => chrome.storage.local.get('coachCfg')
    .then(({ coachCfg }) => chrome.storage.local.set({ coachCfg: Object.assign({}, coachCfg, x) })), o);
  await setCoach({ orBase: OR_BASE });

  // Zähler zurücksetzen: Tageszähler (local) und Minutenfenster (session)
  const resetUse = () => sw.evaluate(() => Promise.all([chrome.storage.local.remove('coachUse'), chrome.storage.session.remove(['coachRate_ghost', 'coachRate_hint'])]));
  // Anfragen wie aus dem Fenster am Käfer-Symbol (Erweiterungsseite)
  let extPage = null;
  const bg = async (op, extra) => {
    if (!extPage) { extPage = await ctx.newPage(); await extPage.goto(`chrome-extension://${EXT_ID}/popup.html`); }
    return extPage.evaluate(([o, x]) => chrome.runtime.sendMessage(Object.assign({ lcdbg: 'bg', op: o }, x)), [op, extra || {}]);
  };

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.goto('https://leetcode.com/problems/function-composition/');

  let current = '';
  const step = async (name, fn) => {
    current = name;
    try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message.slice(0, 400)); process.exitCode = 1; }
  };
  // Anfrage aus der Hauptwelt über die Brücke (wie coach.js)
  const bridge = (op, payload) => page.evaluate(([o, p]) => new Promise((resolve) => {
    const id = 'test' + Math.random();
    const on = (e) => {
      if (e.source !== window || !e.data || e.data.lcdbgCoach !== 'res' || e.data.id !== id) return;
      window.removeEventListener('message', on);
      resolve(e.data);
    };
    window.addEventListener('message', on);
    setTimeout(() => { window.removeEventListener('message', on); resolve({ error: 'timeout (Test)' }); }, 5000);
    window.postMessage(Object.assign({ lcdbgCoach: 'req', id, op: o }, p), location.origin);
  }), [op, payload || {}]);
  const llm = (kind = 'hint', extra) => bridge('llm', Object.assign({ kind, messages: [{ role: 'user', content: 'hallo' }] }, extra));

  // ---------------------------------------------------------------- Task 5: Brücke

  await step('Brücke ohne Schlüssel: nokey', async () => {
    const n = or.reqs.length;
    const r = await llm();
    assert.strictEqual(r.error, 'nokey');
    assert.strictEqual(or.reqs.length, n, 'keine Anfrage an OpenRouter');
  });

  await step('Brücke mit Schlüssel: Text kommt zurück, Schlüssel nicht', async () => {
    await setCoach({ key: 'sk-test-123' });
    answer('{"text":"Was zählt?"}');
    const r = await llm('hint', { max_tokens: 5000 });
    assert.strictEqual(r.text, '{"text":"Was zählt?"}');
    assert.ok(!JSON.stringify(r).includes('sk-test'), 'Schlüssel in der Antwort');
    const q = or.reqs[or.reqs.length - 1];
    assert.strictEqual(q.headers.authorization, 'Bearer sk-test-123');
    assert.strictEqual(q.url, '/api/v1/chat/completions');
    assert.strictEqual(q.body.model, 'anthropic/claude-sonnet-4.6');
    assert.ok(q.body.max_tokens <= 400, 'max_tokens ' + q.body.max_tokens);
    answer('});');
    await llm('ghost');
    assert.strictEqual(or.reqs[or.reqs.length - 1].body.model, 'anthropic/claude-haiku-4.5');
    assert.strictEqual(await page.evaluate(() => document.documentElement.outerHTML.includes('sk-test')), false);
  });

  await step('HTTP-Fehler und kaputte Antwort', async () => {
    answer({ status: 500 });
    const r = await llm();
    assert.strictEqual(r.error, 'http');
    assert.strictEqual(r.status, 500);
    answer({ raw: '{}' });
    assert.strictEqual((await llm()).error, 'bad');
  });

  await step('Minutenlimit', async () => {
    await resetUse();
    let r = null;
    for (let i = 0; i < 21; i++) { answer('x'); r = await llm(); }
    assert.strictEqual(r.error, 'limit');
    assert.ok(r.retryInMs > 0, 'retryInMs ' + r.retryInMs);
    or.queue.length = 0;
  });

  await step('Tageslimit', async () => {
    await resetUse();
    await setCoach({ dailyLimit: 2 });
    answer('a', 'b', 'c');
    assert.ok((await llm()).text);
    assert.ok((await llm()).text);
    const r = await llm();
    assert.strictEqual(r.error, 'limit');
    or.queue.length = 0;
    await setCoach({ dailyLimit: 300 });
    await resetUse();
  });

  await step('Review I5: übergroße oder fremde Anfragen werden abgelehnt', async () => {
    await resetUse();
    const n0 = or.reqs.length;
    const big = 'x'.repeat(40000);
    const m = (role, content) => ({ role, content });
    assert.strictEqual((await bridge('llm', { kind: 'hint', messages: [m('user', 'a'), m('user', 'b'), m('user', 'c'), m('user', 'd'), m('user', 'e')] })).error, 'bad');
    assert.strictEqual((await bridge('llm', { kind: 'hint', messages: [m('user', big)] })).error, 'bad');
    assert.strictEqual((await bridge('llm', { kind: 'hint', messages: [m('tool', 'a')] })).error, 'bad');
    assert.strictEqual((await bridge('llm', { kind: 'egal', messages: [m('user', 'a')] })).error, 'bad');
    assert.strictEqual(or.reqs.length, n0, 'abgelehnte Anfrage ging trotzdem raus');
  });

  await step('Review I4: Ghost-Text verbraucht nicht das Budget der Hinweise', async () => {
    await resetUse();
    let r = null;
    for (let i = 0; i < 16; i++) { answer('x'); r = await llm('ghost'); }
    assert.strictEqual(r.error, 'limit', 'Ghost-Minutenlimit greift nicht');
    or.queue.length = 0;
    answer('{"text":"Frage?"}');
    assert.ok((await llm('hint')).text, 'Hinweis vom Ghost-Budget blockiert');
    await resetUse();
  });

  await step('Schlüssel gelöscht während Seite offen', async () => {
    await bg('saveCoach', { coach: { clearKey: true } });
    assert.strictEqual((await llm()).error, 'nokey');
    assert.strictEqual((await bridge('cfg')).hasKey, false);
    await setCoach({ key: 'sk-test-123' });
    assert.strictEqual((await bridge('cfg')).hasKey, true);
  });

  await step('Log: anhängen, deckeln, exportieren', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
    const rows = Array.from({ length: 5003 }, (_, i) => ({ t: i, slug: 's', ev: 'open' }));
    assert.strictEqual((await bridge('log', { rows })).n, 5000);
    const all = (await bg('exportLog')).rows;
    assert.strictEqual(all.length, 5000);
    assert.strictEqual(all[0].t, 3, 'älteste fallen raus');
    const st = await bg('coachState');
    assert.strictEqual(st.logCount, 5000);
    assert.strictEqual(st.hasKey, true);
    assert.ok(!JSON.stringify(st).includes('sk-test'), 'Schlüssel im Zustand fürs Fenster');
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
  });

  // ---------------------------------------------------------------- Task 6: Fenster am Käfer-Symbol

  await step('Fenster: Schlüssel speichern, Modelle, Export', async () => {
    await bg('saveCoach', { coach: { clearKey: true } });
    await bridge('log', { rows: [{ t: 1, slug: 'x', ev: 'open' }] });
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${EXT_ID}/popup.html#alle`);
    await p.locator('#coachMsg:not(:text("…"))').waitFor({ timeout: 5000 });
    assert.match(await p.locator('#coachMsg').innerText(), /Kein Schlüssel/);
    assert.strictEqual(await p.locator('#ghostModel').inputValue(), 'anthropic/claude-haiku-4.5');
    assert.strictEqual(await p.locator('#hintModel').inputValue(), 'anthropic/claude-sonnet-4.6');
    assert.strictEqual(await p.locator('#dailyLimit').inputValue(), '300');
    assert.strictEqual(await p.locator('#nativeSuggest').isChecked(), false);
    assert.match(await p.locator('#logCount').innerText(), /1/);
    await p.locator('#orKey').fill('sk-or-neu');
    await p.locator('#coachForm button[type=submit]').click();
    await p.waitForFunction(() => /Schlüssel gespeichert/.test(document.querySelector('#coachMsg').innerText), null, { timeout: 5000 });
    assert.strictEqual(await p.locator('#orKey').inputValue(), '');
    assert.strictEqual(await p.locator('#orKey').getAttribute('placeholder'), '•••••• (gespeichert)');
    assert.ok(await p.locator('#clearKey').isVisible());
    assert.strictEqual((await bridge('cfg')).hasKey, true);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('#exportLog').click()]);
    assert.match(dl.suggestedFilename(), /^lerncoach-log-\d{4}-\d{2}-\d{2}\.json$/);
    const rows = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    assert.ok(Array.isArray(rows) && rows.length === 1);
    await p.locator('#clearKey').click();
    await p.waitForFunction(() => /Kein Schlüssel/.test(document.querySelector('#coachMsg').innerText), null, { timeout: 5000 });
    await p.close();
    await setCoach({ key: 'sk-test-123' });
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
  });

  // ---------------------------------------------------------------- Task 7: Ereignisse

  // Mitschnitt der Ereignisse: Listener nur einmal pro Seitenladen, sonst kämen sie doppelt an
  const listen = () => page.evaluate(() => {
    window.__ev = [];
    if (window.__evOn) return;
    window.__evOn = true;
    for (const n of ['lcdbg-run', 'lcdbg-attempt', 'lcdbg-result', 'lcdbg-accepted'])
      window.addEventListener(n, (e) => window.__ev.push([n, e.detail]));
  });
  const events = (name) => page.evaluate((n) => window.__ev.filter(([x]) => x === n).map(([, d]) => d), name);
  const waitEvent = (name) => page.waitForFunction((n) => window.__ev.some(([x]) => x === n), name, { timeout: 8000 });
  lc.routes.push([/\/interpret_solution\//, (r) => r.fulfill({ contentType: 'application/json', body: '{"interpret_id":"runcode_1"}' })]);
  lc.routes.push([/\/submissions\/detail\/runcode_1\/check\//, (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ state: 'SUCCESS', status_msg: 'Accepted', submission_id: 'runcode_1', correct_answer: false }) })]);
  lc.routes.push([/\/submissions\/detail\/42\/check\//, (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ state: 'SUCCESS', status_msg: 'Accepted', status_code: 10, submission_id: '42' }) })]);
  lc.routes.push([/\/problems\/[^/]+\/submit\//, (r) => r.fulfill({ contentType: 'application/json', body: '{"submission_id":42}' })]);

  await step('Ereignis lcdbg-run nach 🐞-Prüfung', async () => {
    await page.reload();
    await listen();
    await page.locator('.lcdbg-overlay .pill').click();
    await waitEvent('lcdbg-run');
    const [d] = await events('lcdbg-run');
    assert.strictEqual(d.slug, 'function-composition');
    assert.strictEqual(d.ok, true);
    assert.match(d.code, /reduceRight/);
    assert.match(d.summary, /stimmen/);
    await page.locator('[data-act="close"]').click();
  });

  await step('Ereignisse bei Run: Versuch und Ergebnis', async () => {
    await listen();
    await page.evaluate(() => fetch('/problems/function-composition/interpret_solution/', { method: 'POST', body: JSON.stringify({ typed_code: 'X' }) })
      .then(() => fetch('/submissions/detail/runcode_1/check/')));
    await waitEvent('lcdbg-result');
    assert.deepStrictEqual(await events('lcdbg-attempt'), [{ slug: 'function-composition', src: 'run', code: 'X' }]);
    assert.deepStrictEqual(await events('lcdbg-result'), [{ slug: 'function-composition', src: 'run', status: 'Accepted', correct: false }]);
    assert.deepStrictEqual(await events('lcdbg-accepted'), [], 'Run ist keine Einsendung');
  });

  await step('Ereignisse bei Submit: Versuch, Ergebnis, Accepted', async () => {
    await listen();
    await page.evaluate(() => fetch('/problems/function-composition/submit/', { method: 'POST', body: JSON.stringify({ typed_code: 'Y' }) })
      .then(() => fetch('/submissions/detail/42/check/')));
    await waitEvent('lcdbg-accepted');
    assert.deepStrictEqual(await events('lcdbg-attempt'), [{ slug: 'function-composition', src: 'submit', code: 'Y' }]);
    assert.deepStrictEqual(await events('lcdbg-result'), [{ slug: 'function-composition', src: 'submit', status: 'Accepted', correct: true }]);
    assert.deepStrictEqual(await events('lcdbg-accepted'), [{ slug: 'function-composition' }]);
  });

  await step('LCDBG_HOST: Aufgabe und Aufgabentext', async () => {
    assert.strictEqual(await page.evaluate(() => window.LCDBG_HOST.slug()), 'function-composition');
    assert.match(await page.evaluate(() => window.LCDBG_HOST.description()), /function composition/);
  });

  // ---------------------------------------------------------------- Task 8: Editor (echtes Monaco)

  const MONACO_URL = 'https://leetcode.com/problems/function-composition/?monaco=1';
  // localStorage gilt für ganz leetcode.com: Coach-Zustand früherer Schritte (z. B. Accepted) vorher löschen
  const clearCoachState = () => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('lcdbg:coach:')) localStorage.removeItem(k); });
  const openMonaco = async (url = MONACO_URL) => {
    await clearCoachState();
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`monaco (${current}): ` + e.message + ' ' + String(e.stack || '').split('\n').slice(1, 4).join(' | ')));
    await p.goto(url);
    await p.waitForFunction(() => window.__ed && document.querySelector('[data-lcdbg-coach]'), null, { timeout: 15000 });
    return p;
  };
  const endOfCode = async (p) => {
    await p.evaluate(() => { const m = window.__ed.getModel(), L = m.getLineCount(); window.__ed.setPosition({ lineNumber: L, column: m.getLineMaxColumn(L) }); window.__ed.focus(); });
  };
  const ghostShown = (p) => p.evaluate(() => !!document.querySelector('.ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview, .lcdbg-ghost'));
  const reqsNow = () => or.reqs.length;
  const logRows = async () => { await page.waitForTimeout(700); return (await bg('exportLog')).rows; };
  const suggestOff = (p) => p.evaluate(() => {
    const E = monaco.editor.EditorOption, q = window.__ed.getOption(E.quickSuggestions);
    const off = q === false || (typeof q === 'object' && Object.values(q).every((v) => v === false || v === 'off'));
    return off && window.__ed.getOption(E.suggestOnTriggerCharacters) === false;
  });

  await step('Ghost: erscheint erst nach Pause, Tab übernimmt', async () => {
    await resetUse();
    await setCoach({ key: 'sk-test-123', nativeSuggest: false });
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
    or.queue.length = 0;
    const p = await openMonaco();
    await endOfCode(p);
    answer('});');
    const n0 = reqsNow();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(500);
    assert.strictEqual(reqsNow(), n0, 'vor Ablauf der Pause schon angefragt');
    await p.waitForFunction(() => !!document.querySelector('.ghost-text-decoration, .ghost-text, .lcdbg-ghost'), null, { timeout: 4000 });
    assert.strictEqual(reqsNow(), n0 + 1);
    assert.strictEqual(or.reqs[or.reqs.length - 1].body.model, 'anthropic/claude-haiku-4.5');
    await p.keyboard.press('Tab');
    await p.waitForTimeout(200);
    const last = await p.evaluate(() => { const m = window.__ed.getModel(); return m.getLineContent(m.getLineCount()); });
    assert.strictEqual(last.trim(), '});');
    const evs = (await logRows()).map((r) => r.ev);
    assert.ok(evs.includes('ghostShown'), evs.join(','));
    assert.ok(evs.includes('ghostAccepted'), evs.join(','));
    await p.close();
  });

  await step('Ghost: verbotener Vorschlag erscheint nicht', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
    const p = await openMonaco();
    await endOfCode(p);
    answer('if (x > 0) {');
    const n0 = reqsNow();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(2600);
    assert.strictEqual(reqsNow(), n0 + 1);
    assert.strictEqual(await ghostShown(p), false);
    const rej = (await logRows()).filter((r) => r.ev === 'ghostRejected');
    assert.strictEqual(rej.length, 1);
    assert.match(rej[0].reason, /Kontrollfluss/);
    await p.close();
  });

  await step('Ghost: Alt+Shift+Leertaste fragt sofort', async () => {
    const p = await openMonaco();
    await endOfCode(p);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1900);   // die automatische Anfrage nach der Pause ist durch
    answer('});');
    const n0 = reqsNow();
    await p.keyboard.press('Alt+Shift+Space');
    await p.waitForTimeout(700);
    assert.strictEqual(reqsNow(), n0 + 1, 'nicht sofort angefragt');
    await p.waitForFunction(() => !!document.querySelector('.ghost-text-decoration, .ghost-text, .lcdbg-ghost'), null, { timeout: 3000 });
    await p.close();
  });

  await step('Ghost-Rückfall ohne Inline-API: Dekoration, Tab, veraltet verworfen', async () => {
    const p = await openMonaco(MONACO_URL + '&noinline=1');
    await endOfCode(p);
    answer('});');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.lcdbg-ghost', { timeout: 4000 });
    await p.keyboard.press('Tab');
    await p.waitForTimeout(150);
    let last = await p.evaluate(() => { const m = window.__ed.getModel(); return m.getLineContent(m.getLineCount()); });
    assert.strictEqual(last.trim(), '});');
    assert.strictEqual(await p.locator('.lcdbg-ghost').count(), 0);
    // langsame Antwort, inzwischen weitergetippt: nichts anzeigen
    answer({ text: '});', delay: 2000 });
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1700);
    await p.keyboard.type('a');
    await p.waitForTimeout(1200);
    assert.strictEqual(await p.locator('.lcdbg-ghost').count(), 0, 'veralteter Vorschlag angezeigt');
    // Review I3: langsame Antwort, inzwischen Cursor woanders (ohne Änderung): nichts anzeigen, Tab bleibt Tab
    answer({ text: '});', delay: 2000 });
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1700);
    await p.evaluate(() => window.__ed.setPosition({ lineNumber: 6, column: 1 }));
    await p.waitForTimeout(2500);   // Antwort kommt bei ~3,5 s
    assert.strictEqual(await p.locator('.lcdbg-ghost').count(), 0, 'Vorschlag an alter Stelle nach Cursorbewegung');
    await p.close();
  });

  await step('Karte bei .red, Esc schließt, nichts eingefügt', async () => {
    const p = await openMonaco();
    await endOfCode(p);
    await p.keyboard.press('Enter');
    await p.keyboard.type('functions.red');
    await p.waitForSelector('.lcdbg-card', { state: 'visible', timeout: 3000 });
    const t = await p.locator('.lcdbg-card').innerText();
    assert.match(t, /reduce\(callback\(acc, x, i, arr\), init\)/);
    assert.match(t, /reduceRight/);
    assert.match(t, /Startwert/);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    assert.ok(!(await p.locator('.lcdbg-card').isVisible()), 'Karte noch offen');
    const last = await p.evaluate(() => { const m = window.__ed.getModel(); return m.getLineContent(m.getLineCount()); });
    assert.strictEqual(last.trim(), 'functions.red');   // ältere Monaco-Versionen rücken nach */ ein
    await p.close();
  });

  await step('Hover über einem API-Namen zeigt die Karte', async () => {
    const p = await openMonaco();
    const xy = await p.evaluate(() => {
      const m = window.__ed.getModel(), L = m.getLinesContent().findIndex((l) => l.includes('reduceRight')) + 1;
      const col = m.getLineContent(L).indexOf('reduceRight') + 4;
      window.__ed.revealLineInCenter(L);
      const v = window.__ed.getScrolledVisiblePosition({ lineNumber: L, column: col }), r = window.__ed.getDomNode().getBoundingClientRect();
      return { x: r.left + v.left + 2, y: r.top + v.top + v.height / 2 };
    });
    await p.mouse.move(xy.x - 30, xy.y);
    await p.mouse.move(xy.x, xy.y, { steps: 3 });
    await p.waitForFunction(() => [...document.querySelectorAll('.monaco-hover')].some((h) => /Startwert/.test(h.innerText)), null, { timeout: 5000 });
    const hover = await p.evaluate(() => [...document.querySelectorAll('.monaco-hover')].map((h) => h.innerText).join(' '));
    assert.match(hover, /reduceRight\(callback\(acc, x, i, arr\), init\)/);
    await p.close();
  });

  await step('LeetCode-Vorschläge aus vor Accepted, an mit Einstellung', async () => {
    let p = await openMonaco();
    await p.waitForFunction(() => true);
    await p.waitForTimeout(300);
    assert.strictEqual(await suggestOff(p), true);
    await p.close();
    await setCoach({ nativeSuggest: true });
    p = await openMonaco();
    await p.waitForTimeout(300);
    assert.strictEqual(await suggestOff(p), false);
    await p.close();
    await setCoach({ nativeSuggest: false });
  });

  await step('Andere Sprache: keine Karte, kein Ghost, Vorschläge unangetastet', async () => {
    const p = await openMonaco();
    await p.evaluate(() => monaco.editor.setModelLanguage(window.__ed.getModel(), 'python'));
    await p.waitForTimeout(1200);
    assert.strictEqual(await suggestOff(p), false, 'Vorschläge bei Python aus');
    await endOfCode(p);
    const n0 = reqsNow();
    await p.keyboard.press('Enter');
    await p.keyboard.type('x.red');
    await p.waitForTimeout(2200);
    assert.strictEqual(await p.locator('.lcdbg-card').isVisible().catch(() => false), false);
    assert.strictEqual(reqsNow(), n0, 'Ghost-Anfrage bei Python');
    await p.close();
  });

  // ---------------------------------------------------------------- Task 9: Hinweis-Panel

  const CO = '.lcdbg-coach';
  const q = (sel) => page.locator(`${CO} ${sel}`);
  const fresh = async (slugName = 'function-composition') => {
    await page.evaluate((s) => { for (const k of Object.keys(localStorage)) if (k.startsWith('lcdbg:coach:')) localStorage.removeItem(k); void s; }, slugName);
    await page.goto('https://leetcode.com/problems/function-composition/');
    await page.locator(`${CO} [data-c="toggle"]`).waitFor({ timeout: 8000 });
    await listen();
    or.queue.length = 0;
  };
  const openPanel = async () => { if (!(await q('.cpanel').isVisible())) await q('[data-c="toggle"]').click(); await q('.cpanel').waitFor(); };
  const debugRun = async () => {
    await page.evaluate(() => { window.__ev = []; });
    if (await page.locator('.lcdbg-overlay .pill').isVisible()) await page.locator('.lcdbg-overlay .pill').click();
    else await page.locator('.lcdbg-overlay [data-act="check"]').click();
    await waitEvent('lcdbg-run');
    await page.waitForTimeout(100);
  };
  const plan = async (text) => { await q('#plan').fill(text); await q('[data-c="plan"]').click(); await page.waitForTimeout(100); };
  const textOf = (sel) => q(sel).innerText();
  const waitIn = (sel, re) => page.waitForFunction(([co, s, src]) => {
    const r = document.querySelector(co); const el = r && r.shadowRoot.querySelector(s);
    return el && new RegExp(src).test(el.innerText);
  }, [CO, sel, re.source], { timeout: 6000 });

  await step('Panel: L1 gesperrt, nach 🐞-Prüfung offen', async () => {
    await setCoach({ key: 'sk-test-123' });
    await resetUse();
    await fresh();
    await openPanel();
    assert.match(await textOf('.lvl'), /Stufe 0 von 4/);
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), true);
    assert.match(await q('[data-c="next"]').getAttribute('title'), /Erst ein eigener Versuch/);
    await debugRun();
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), true, 'Review M4: unveränderte Vorlage hat freigeschaltet');
    await page.evaluate((c) => window.__setCode(c), SOLUTION.replace('return function(x) {', 'return function(x) { // eigener Versuch'));
    await debugRun();
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), false);
    answer('{"text":"Was gibt reduceRight zurück?"}');
    await q('[data-c="next"]').click();
    await waitIn('.htext', /Was gibt reduceRight zurück\?/);
    assert.match(await textOf('.lvl'), /Stufe 1 von 4 · Leitfrage/);
    const sent = or.reqs[or.reqs.length - 1].body.messages;
    assert.match(sent[1].content, /function composition/i, 'Aufgabentext fehlt');
    assert.match(sent[1].content, /reduceRight/, 'Code fehlt');
    assert.match(sent[1].content, /Letztes Testergebnis: Alle Beispiele stimmen/, 'letztes Testergebnis fehlt');
  });

  await step('Panel: L2 erst nach geändertem Code', async () => {
    await plan('ab jetzt reicht kein Plan mehr, sondern ein Lauf');
    assert.match(await textOf('.fb'), /Ab Stufe 2 zählt nur ein Lauf mit geändertem Code/);
    await debugRun();
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), true, 'gleicher Code hat freigeschaltet');
    await page.evaluate((c) => window.__setCode(c), SOLUTION.replace('reduceRight', 'reduce'));
    await debugRun();
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), false);
    await page.locator('.lcdbg-overlay [data-act="close"]').click();
    await page.evaluate((c) => window.__setCode(c), SOLUTION);
  });

  await step('Panel: Plan-Satz schaltet frei', async () => {
    await fresh();
    await openPanel();
    await plan('erst zählen dann vergleichen bitte');
    assert.match(await textOf('.fb'), /mindestens 6 Wörter/);
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), true);
    await plan('erst alle Funktionen von rechts anwenden, dann zurückgeben');
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), false);
    assert.strictEqual(await q('#plan').inputValue(), '');
  });

  await step('Panel: Notausgang', async () => {
    await fresh();
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
    await openPanel();
    answer('{"text":"Was soll am Ende herauskommen?"}');
    await q('[data-c="escape"]').click();
    await waitIn('.htext', /Was soll am Ende herauskommen/);
    assert.match(await textOf('.lvl'), /Stufe 1 von 4/);
    assert.match(await textOf('.fb'), /Ohne eigenen Versuch – kommt in die Wiedervorlage\./);
    const evs = (await logRows()).map((r) => r.ev);
    assert.ok(evs.includes('escape') && evs.includes('hint') && evs.includes('open'), evs.join(','));
  });

  await step('Panel: Hinweis mit Code wird neu angefragt, dann verworfen', async () => {
    await fresh();
    await openPanel();
    await plan('erst alle Funktionen von rechts anwenden, dann zurückgeben');
    answer('{"text":"nutze `reduce`"}', '{"text":"nutze `reduce` bitte"}');
    const n0 = reqsNow();
    await q('[data-c="next"]').click();
    await waitIn('.cstatus', /Hinweis enthielt Code – verworfen/);
    assert.strictEqual(reqsNow(), n0 + 2);
    assert.match(or.reqs[or.reqs.length - 1].body.messages[0].content, /Die letzte Antwort enthielt Code/);
    assert.match(await textOf('.lvl'), /Stufe 0 von 4/);
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), false, 'Versuch wurde verbraucht');
  });

  await step('Panel: kaputte Antwort', async () => {
    answer('kein json');
    await q('[data-c="next"]').click();
    await waitIn('.cstatus', /Antwort unbrauchbar – nochmal versuchen/);
    assert.match(await textOf('.lvl'), /Stufe 0 von 4/);
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), false);
  });

  await step('Panel: L4 Lead-and-Reveal', async () => {
    answer('{"text":"Frage?"}', '{"text":"Konzept: Funktionskomposition."}', '{"text":"für jede Funktion von rechts – anwenden"}');
    for (const n of [1, 2, 3]) {
      await q('[data-c="escape"]').click();
      await waitIn('.lvl', new RegExp(`Stufe ${n} von 4`));
    }
    assert.ok(await q('.l4').isVisible(), 'Absichtsfeld fehlt ab Stufe 3');
    assert.ok(await q('[data-c="next"]').isHidden(), 'normaler Weiter-Knopf ab Stufe 3 weg');
    await q('#intent').fill('zu kurz');
    await page.evaluate((c) => window.__setCode(c), SOLUTION.replace('reduceRight', 'reduce'));
    await debugRun();
    await page.locator('.lcdbg-overlay [data-act="close"]').click();
    await q('[data-c="reveal"]').click();
    assert.match(await textOf('.fb'), /mindestens 3 Wörter/);
    answer('{"verdict":"stimmt","feedback":"Genau, von rechts nach links.","line":"return functions.reduceRight((acc, fn) => fn(acc), x);"}');
    await q('#intent').fill('von rechts nach links anwenden');
    await q('[data-c="reveal"]').click();
    await waitIn('.reveal', /reduceRight/);
    assert.match(await textOf('.verdict'), /stimmt/);
    assert.match(await textOf('.lvl'), /Stufe 4 von 4/);
    assert.match(or.reqs[or.reqs.length - 1].body.messages[1].content, /von rechts nach links anwenden/);
    const guard = await page.evaluate((co) => {
      const el = document.querySelector(co).shadowRoot.querySelector('.reveal');
      const ev = new Event('copy', { bubbles: true, cancelable: true, composed: true });
      el.dispatchEvent(ev);
      return { sel: getComputedStyle(el).userSelect, prevented: ev.defaultPrevented };
    }, CO);
    assert.deepStrictEqual(guard, { sel: 'none', prevented: true });
  });

  await step('Panel: Schnell-Klick', async () => {
    await fresh();
    await openPanel();
    await plan('erst alle Funktionen von rechts anwenden, dann zurückgeben');
    answer(JSON.stringify({ text: Array(40).fill('wort').join(' ') }), '{"text":"Konzept."}');
    await q('[data-c="next"]').click();
    await waitIn('.lvl', /Stufe 1/);
    await page.evaluate((c) => window.__setCode(c), SOLUTION.replace('reduceRight', 'reduce'));
    await debugRun();
    await page.locator('.lcdbg-overlay [data-act="close"]').click();
    await q('[data-c="next"]').click();
    await waitIn('.lvl', /Stufe 2/);
    assert.match(await textOf('.fb'), /Zu schnell gelesen\? Erst probieren, dann die nächste Stufe\./);
  });

  await step('Review M3: Lauf während einer Hinweis-Anfrage geht nicht verloren', async () => {
    await fresh();
    await openPanel();
    await plan('erst alle Funktionen von rechts anwenden, dann zurückgeben');
    answer({ text: '{"text":"Frage?"}', delay: 2500 });
    await q('[data-c="next"]').click();
    await page.evaluate((c) => window.__setCode(c), SOLUTION.replace('reduceRight', 'reduce'));
    await debugRun();
    await page.locator('.lcdbg-overlay [data-act="close"]').click();
    await waitIn('.lvl', /Stufe 1/);
    assert.strictEqual(await q('[data-c="next"]').isDisabled(), false, 'Lauf während der Anfrage wurde überschrieben');
    await page.evaluate((c) => window.__setCode(c), SOLUTION);
  });

  await step('Panel: kein Schlüssel', async () => {
    await setCoach({ key: '' });
    await fresh();
    await openPanel();
    await plan('erst alle Funktionen von rechts anwenden, dann zurückgeben');
    await q('[data-c="next"]').click();
    await waitIn('.cstatus', /Schlüssel im Käfer-Fenster eintragen/);
    assert.match(await textOf('.lvl'), /Stufe 0 von 4/);
    await setCoach({ key: 'sk-test-123' });
  });

  await step('Panel: Aufgabenwechsel ohne Neuladen', async () => {
    await fresh();
    await openPanel();
    answer('{"text":"Frage?"}');
    await q('[data-c="escape"]').click();
    await waitIn('.lvl', /Stufe 1 von 4/);
    await page.evaluate(() => history.pushState({}, '', '/problems/ransom-note/'));
    await waitIn('.lvl', /Stufe 0 von 4/);
    assert.strictEqual(await textOf('.htext'), '');
    await page.evaluate(() => history.pushState({}, '', '/problems/function-composition/'));
    await waitIn('.lvl', /Stufe 1 von 4/);
    assert.match(await textOf('.htext'), /Frage\?/);
  });

  // ---------------------------------------------------------------- Task 10: Nach Accepted

  const accept = (p) => p.evaluate(() => fetch('/problems/function-composition/submit/', { method: 'POST', body: JSON.stringify({ typed_code: 'Z' }) })
    .then(() => fetch('/submissions/detail/42/check/')));
  const pq = (p, sel) => p.locator(`${CO} ${sel}`);
  const pWaitIn = (p, sel, re) => p.waitForFunction(([co, s, src]) => {
    const r = document.querySelector(co); const el = r && r.shadowRoot.querySelector(s);
    return el && new RegExp(src).test(el.innerText);
  }, [CO, sel, re.source], { timeout: 6000 });

  await step('Accepted → Selbsterklärung → Review', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
    const p = await openMonaco();
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('lcdbg:coach:')) localStorage.removeItem(k); });
    await p.reload();
    await p.waitForFunction(() => window.__ed && document.querySelector('[data-lcdbg-coach]'), null, { timeout: 15000 });
    await p.waitForTimeout(300);
    assert.strictEqual(await suggestOff(p), true);
    await accept(p);
    await pq(p, '#selfexpl').waitFor({ state: 'visible', timeout: 6000 });
    assert.ok(await pq(p, '[data-c="next"]').isHidden(), 'Leiter nach Accepted noch sichtbar');
    answer('{"verdict":"teilweise","feedback":"Korrekt, aber die Laufzeit ist O(n) pro Aufruf."}');
    await pq(p, '#selfexpl').fill('Weil reduceRight von rechts anwendet, O(1).');
    await pq(p, '[data-c="selfexpl"]').click();
    await pWaitIn(p, '.sefb', /O\(n\) pro Aufruf/);
    assert.match(or.reqs[or.reqs.length - 1].body.messages[1].content, /von rechts anwendet, O\(1\)/);
    assert.ok(await pq(p, '[data-c="review"][data-k="alt"]').isVisible());
    answer('Andere Lösung:\n```js\nconst compose = (fs) => (x) => fs.reduceRight((a, g) => g(a), x);\n```\nGleiche Idee, kürzer.');
    await pq(p, '[data-c="review"][data-k="alt"]').click();
    await pWaitIn(p, '.rtext', /Gleiche Idee/);
    assert.match(await pq(p, '.rtext pre').innerText(), /const compose = \(fs\)/);
    assert.match(await pq(p, '[data-c="toggle"]').innerText(), /🎓 Review/);
    assert.strictEqual(await suggestOff(p), false, 'LeetCode-Vorschläge nach Accepted nicht zurück');
    const evs = (await logRows()).map((r) => r.ev);
    for (const ev of ['accepted', 'selfExpl', 'review']) assert.ok(evs.includes(ev), ev + ' fehlt: ' + evs.join(','));
    // Accepted bleibt nach Neuladen
    await p.reload();
    await p.waitForFunction(() => window.__ed && document.querySelector('[data-lcdbg-coach]'), null, { timeout: 15000 });
    await pq(p, '[data-c="toggle"]').waitFor();
    assert.match(await pq(p, '[data-c="toggle"]').innerText(), /🎓 Review/);
    await p.close();
  });

  await step('Selbsterklärung überspringen wird geloggt', async () => {
    await fresh();
    await sw.evaluate(() => chrome.storage.local.set({ coachLog: [] }));
    await accept(page);
    await q('[data-c="skipexpl"]').waitFor({ state: 'visible', timeout: 6000 });
    await q('[data-c="skipexpl"]').click();
    assert.ok(await q('[data-c="review"][data-k="complexity"]').isVisible());
    answer('Frage beantwortet.');
    await q('#ask').fill('Warum nicht reduce?');
    await q('[data-c="ask"]').click();
    await waitIn('.rtext', /Frage beantwortet/);
    assert.match(or.reqs[or.reqs.length - 1].body.messages[1].content, /Warum nicht reduce\?/);
    const evs = (await logRows()).map((r) => r.ev);
    assert.ok(evs.includes('selfExplSkipped'), evs.join(','));
  });

  if (SHOT) {
    await fresh();
    await openPanel();
    await plan('erst alle Funktionen von rechts anwenden, dann zurückgeben');
    answer('{"text":"Was liefert die innerste Funktion, wenn x hineingeht – und wer bekommt dieses Ergebnis als Nächstes?"}');
    await q('[data-c="next"]').click();
    await waitIn('.lvl', /Stufe 1/);
    await page.screenshot({ path: SHOT });
    const p = await openMonaco();
    await endOfCode(p);
    await p.keyboard.press('Enter');
    await p.keyboard.type('functions.red');
    await p.waitForSelector('.lcdbg-card', { state: 'visible' });
    await p.screenshot({ path: SHOT.replace(/\.png$/, '-karte.png') });
    await p.close();
    console.log('Screenshot:', SHOT);
  }

  if (errors.length) { console.log('Fehler in der Konsole:\n  ' + errors.join('\n  ')); process.exitCode = 1; }
  server.close();
  await ctx.close();
  void SHOT; void EXT_ID; void RANSOM;
})();
