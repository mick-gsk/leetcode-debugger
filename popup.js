/* Fenster am Käfer-Symbol: startet den Debugger im aktuellen Tab, erklärt, falls es nicht geht,
 * und zeigt bzw. steuert die Aktualisierung aus GitHub (über background.js). */
(async () => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const ask = (tabId, msg) => new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (r) => resolve(chrome.runtime.lastError ? null : r || null));
    } catch (e) { resolve(null); }
  });
  const bg = (op, extra) => chrome.runtime.sendMessage(Object.assign({ lcdbg: 'bg', op }, extra)).catch((e) => ({ error: e.message }));

  // Normalfall: aktiver Tab. Für Tests (#alle): den Tab suchen, in dem content.js antwortet.
  async function findTab() {
    const tabs = await chrome.tabs.query(location.hash === '#alle' ? {} : { active: true, currentWindow: true });
    for (const t of tabs) {
      const st = await ask(t.id, { lcdbg: 'status' });
      if (st) return { id: t.id, st };
    }
    return null;
  }

  // ------------------------------------------------------------ Tab

  function show(st) {
    const msg = $('#msg'), checks = [];
    const item = (ok, text) => checks.push(`<li data-i="${ok ? '✅' : '❌'}">${text}</li>`);
    if (!st) {
      msg.className = 'msg bad';
      msg.innerHTML = '<b>Die Extension läuft in diesem Tab nicht.</b> Wenn das eine LeetCode-Aufgabe ist:' +
        '<ol><li>Seite mit <b>F5</b> neu laden.</li>' +
        '<li>Rechtsklick auf das Käfer-Symbol → <b>„Kann Websitedaten lesen und ändern“</b> → <b>„Auf leetcode.com“</b> wählen, dann neu laden.</li>' +
        '<li>Hilft das nicht: in <b>chrome://extensions</b> oben auf <b>„Aktualisieren“</b> klicken und neu laden.</li></ol>';
      $('#start').disabled = true;
      $('#checks').innerHTML = '';
      return;
    }
    item(true, 'Extension läuft in diesem Tab');
    if (!st.host) {
      item(false, 'Debugger-Code ist auf dieser Seite noch nicht geladen – Seite neu laden (F5)');
    } else {
      item(true, `Debugger ${esc(st.version)} geladen <span class="muted">(${esc(st.source)})</span>`);
      item(st.onProblem, st.onProblem ? 'Aufgabenseite erkannt' : 'keine Aufgabenseite (Adresse muss /problems/… sein)');
      if (st.onProblem) {
        item(st.editorFound, st.editorFound ? 'Code-Editor gefunden' : 'Code-Editor nicht gefunden – Knopf sitzt unten rechts im Fenster');
        if (!st.pageScript) item(false, 'Seiten-Teil antwortet nicht – Seite neu laden (F5)');
        else item(st.widget, st.widget ? 'Leiste sitzt als Widget im Editor' : 'Leiste schwebt über der Seite (Editor-Widget nicht möglich)');
        item(st.pillShown || st.open, st.open ? 'Debug-Leiste ist offen' : st.pillShown ? 'Knopf „🐞 Debuggen“ wird angezeigt' : 'Knopf wird nicht angezeigt');
        if (st.covered) item(false, `Knopf ist verdeckt von <code>${esc(st.covered)}</code>`);
        if (st.subs) item(true, `${st.subs} gescheiterte Einsendung${st.subs > 1 ? 'en' : ''} als Testfall übernommen`);
      }
    }
    const good = st.host && st.onProblem;
    msg.className = 'msg ' + (good ? 'ok' : 'bad');
    msg.textContent = good ? 'Bereit. Klick oben startet den Debugger direkt.'
      : st.host ? 'Öffne eine LeetCode-Aufgabe, dann geht es hier los.' : 'Seite neu laden (F5), dann geht es los.';
    $('#start').disabled = !good;
    $('#checks').innerHTML = checks.join('');
  }

  // ------------------------------------------------------------ Aktualisierung

  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `vor ${s} s` : s < 3600 ? `vor ${Math.round(s / 60)} min` : `vor ${Math.round(s / 3600)} h`;
  };

  function showUpd(S) {
    const box = $('#upd');
    if (!S || S.error && !S.local) { box.className = 'msg bad'; box.textContent = 'Hintergrund antwortet nicht: ' + (S && S.error || '?'); return; }
    $('#v').textContent = 'v' + S.running.version;
    const u = S.upd || {}, where = `${esc(S.cfg.repo)} · Zweig <code>${esc(S.cfg.branch)}</code>`;
    const fromGit = S.running.sha ? `GitHub-Stand <code>${S.running.sha.slice(0, 7)}</code>` : 'Ordner';
    $('#details').hidden = S.userScripts;
    if (!S.running.sha && !S.userScripts) {
      box.className = 'msg ok';
      box.innerHTML = `<b>Läuft aus dem Ordner:</b> v${esc(S.local)}. Neuer Stand im Ordner? Einfach die LeetCode-Seite neu laden (F5).` +
        '<div class="muted">Nur bei Änderungen an manifest.json, background.js oder content.js in <code>chrome://extensions</code> auf „Aktualisieren“. ' +
        'Updates aus GitHub (optional): ' + (S.userScripts ? 'Token unter „Quelle (GitHub)“ eintragen.' : '„Nutzerskripts zulassen“ und Token.') + '</div>';
    } else if (u.error) {
      box.className = 'msg bad';
      box.innerHTML = `<b>Update-Prüfung gescheitert:</b> ${esc(u.error)}<div class="muted">Es läuft weiter v${esc(S.running.version)} (${fromGit}).</div>`;
    } else if (u.needsPackage) {
      box.className = 'msg warn';
      box.innerHTML = `<b>v${esc(u.needsPackage)} braucht einmal ein neues Paket</b> (der Rahmen hat sich geändert). Ordner ersetzen und in ` +
        '<code>chrome://extensions</code> auf „Aktualisieren“ klicken.' + `<div class="muted">Bis dahin läuft v${esc(S.running.version)}.</div>`;
    } else {
      box.className = 'msg ok';
      const fresh = u.updatedAt && Date.now() - u.updatedAt < 10 * 60 * 1000 && u.version === S.running.version;
      box.innerHTML = (fresh ? `<b>Update auf v${esc(S.running.version)} geladen</b> (${ago(u.updatedAt)}). LeetCode-Seite neu laden.`
        : `<b>Aktuell:</b> v${esc(S.running.version)} (${fromGit}).`) +
        `<div class="muted">Quelle: ${where}${u.at ? ' · geprüft ' + ago(u.at) : ''}</div>`;
    }
    $('#repo').value = S.cfg.repo;
    $('#branch').value = S.cfg.branch;
    $('#dir').value = S.cfg.dir;
    $('#token').placeholder = S.cfg.hasToken ? '•••••• (gespeichert)' : 'nur für private Repos';
    $('#clearToken').hidden = !S.cfg.hasToken;
    $('#tokenNote').innerHTML = 'Token: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank">fein abgestuftes Token</a>, ' +
      'nur dieses Repo, Recht „Contents: Read-only“. Bleibt lokal in Chrome und geht nur an api.github.com.';
    if (u.error && /Token|privat/.test(u.error)) $('#settings').open = true;
  }

  let found = null;
  const [S] = await Promise.all([bg('state'), findTab().then((f) => { found = f; show(f && f.st); })]);
  showUpd(S);
  // Tab läuft noch mit älterem Code als dem, der jetzt angemeldet ist
  if (found && found.st && found.st.host && S && S.running && found.st.version !== S.running.version) {
    $('#checks').insertAdjacentHTML('beforeend', `<li data-i="🔄">Seite neu laden, um v${esc(S.running.version)} zu nutzen</li>`);
  }

  $('#start').addEventListener('click', async () => {
    if (!found) return;
    const st = await ask(found.id, { lcdbg: 'start' });
    show(st);
    if (st && location.hash !== '#alle') window.close();
  });

  async function busy(btn, fn) {
    const t = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Prüfe …';
    try { showUpd(await fn()); } finally { btn.disabled = false; btn.textContent = t; }
  }
  $('#check').addEventListener('click', () => busy($('#check'), () => bg('check')));
  $('#details').addEventListener('click', () => bg('openDetails'));
  $('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = $('#form button[type=submit]');
    busy(btn, () => bg('saveCfg', { cfg: { repo: $('#repo').value, branch: $('#branch').value, dir: $('#dir').value, token: $('#token').value } }))
      .then(() => { $('#token').value = ''; });
  });
  $('#clearToken').addEventListener('click', () => busy($('#clearToken'), () => bg('saveCfg', { cfg: { clearToken: true } })));

  // ------------------------------------------------------------ Lern-Coach

  function showCoach(C, note) {
    const box = $('#coachMsg');
    if (!C || C.error) { box.className = 'msg bad'; box.textContent = 'Hintergrund antwortet nicht: ' + (C && C.error || '?'); return; }
    box.className = 'msg ' + (C.hasKey ? 'ok' : 'warn');
    box.innerHTML = (note ? `<b>${esc(note)}</b> ` : '') + (C.hasKey
      ? `Bereit. Heute ${C.usedToday} von ${C.dailyLimit} Aufrufen genutzt.`
      : '<b>Kein Schlüssel.</b> Ohne Schlüssel laufen nur die API-Karten; Ghost-Text und Hinweise brauchen OpenRouter.');
    $('#orKey').placeholder = C.hasKey ? '•••••• (gespeichert)' : 'sk-or-…';
    $('#clearKey').hidden = !C.hasKey;
    $('#ghostModel').value = C.ghostModel;
    $('#hintModel').value = C.hintModel;
    $('#dailyLimit').value = C.dailyLimit;
    $('#nativeSuggest').checked = C.nativeSuggest;
    $('#logCount').textContent = C.logCount;
  }
  showCoach(await bg('coachState'));

  $('#coachForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#orKey').value.trim();
    const C = await bg('saveCoach', { coach: {
      key, ghostModel: $('#ghostModel').value, hintModel: $('#hintModel').value,
      dailyLimit: Number($('#dailyLimit').value), nativeSuggest: $('#nativeSuggest').checked,
    } });
    $('#orKey').value = '';
    showCoach(C, key ? 'Schlüssel gespeichert.' : 'Gespeichert.');
  });
  $('#clearKey').addEventListener('click', async () => showCoach(await bg('saveCoach', { coach: { clearKey: true } }), 'Schlüssel gelöscht.'));
  $('#exportLog').addEventListener('click', async () => {
    const r = await bg('exportLog');
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify((r && r.rows) || [], null, 1)], { type: 'application/json' }));
    a.download = `lerncoach-log-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
})();
