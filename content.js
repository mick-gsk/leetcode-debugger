/* Content-Script (Rahmen, ändert sich selten): Der eigentliche Debugger läuft in der Hauptwelt der
 * Seite und wird vom Hintergrund angemeldet (aus GitHub aktualisiert oder aus dem Paket). Dieses
 * Skript sagt ihm nur, wo die Extension liegt, meldet den Seitenaufruf (der Hintergrund schaut
 * dann gedrosselt nach Updates), reicht Anfragen des Fensters am Käfer-Symbol weiter und zeigt
 * nach einem Update einen Hinweis zum Neuladen. */
(() => {
  'use strict';
  if (window.__lcdbgShell) return;
  window.__lcdbgShell = true;

  const de = document.documentElement;
  const manifest = chrome.runtime.getManifest();
  de.dataset.lcdbgExt = chrome.runtime.getURL('');
  de.dataset.lcdbgVersion = manifest.version;

  // ------------------------------------------------------------ Anfragen an die Hauptwelt (host.js)

  let reqId = 0;
  const pending = new Map();
  function askHost(type) {
    return new Promise((resolve) => {
      const id = 'c' + ++reqId;
      pending.set(id, resolve);
      window.postMessage({ lcdbgHost: 'req', id, type }, location.origin);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ error: 'timeout' }); } }, 1500);
    });
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.lcdbgHost !== 'res' || !pending.has(m.id)) return;
    const r = pending.get(m.id);
    pending.delete(m.id);
    r(m);
  });

  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (!m || !m.lcdbg) return;
    if (m.lcdbg === 'updated') { toast(m); return; }
    if (m.lcdbg !== 'start' && m.lcdbg !== 'status') return;
    askHost(m.lcdbg).then((r) => reply(Object.assign({ shell: manifest.version, host: !r.error }, r)));
    return true;   // Antwort kommt asynchron
  });

  // ------------------------------------------------------------ Lern-Coach: Brücke zum Hintergrund

  // coach.js (Hauptwelt) fragt OpenRouter/Log/Einstellungen an; der Schlüssel bleibt im Hintergrund.
  // Jedes Skript der Seite kann hier anfragen – die Minuten-/Tageslimits im Hintergrund deckeln das.
  const COACH_OPS = new Set(['llm', 'log', 'cfg']);
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.lcdbgCoach !== 'req' || !COACH_OPS.has(m.op)) return;
    const answer = (r) => window.postMessage(Object.assign({}, r, { lcdbgCoach: 'res', id: m.id }), location.origin);
    const msg = { lcdbg: 'coach', op: m.op, kind: m.kind, messages: m.messages, max_tokens: m.max_tokens, rows: m.rows };
    try {
      chrome.runtime.sendMessage(msg).then((r) => answer(r || { error: 'bad' }), () => answer({ error: 'reload' }));
    } catch (err) { answer({ error: 'reload' }); }   // Extension neu geladen: Seite braucht F5
  });

  // Seitenaufruf melden: Hintergrund prüft (gedrosselt) auf Updates
  try { chrome.runtime.sendMessage({ lcdbg: 'pageLoad' }).catch(() => {}); } catch (e) { /* Extension neu geladen */ }

  // ------------------------------------------------------------ Hinweis nach einem Update

  function toast(m) {
    let host = document.getElementById('lcdbg-toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'lcdbg-toast';
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646';
      host.attachShadow({ mode: 'open' });
      de.appendChild(host);
    }
    host.shadowRoot.innerHTML = `<style>
      .t { font: 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; background: #252526; color: #ccc; border: 1px solid #454545;
        border-left: 3px solid #ffa116; border-radius: 6px; padding: 10px 12px; box-shadow: 0 4px 14px rgba(0,0,0,.4);
        display: flex; gap: 12px; align-items: center; max-width: 380px; }
      b { color: #fff; }
      button { font: inherit; border: 0; border-radius: 4px; cursor: pointer; padding: 4px 10px; }
      .go { background: #ffa116; color: #1a1a1a; font-weight: 600; }
      .x { background: none; color: #9d9d9d; padding: 4px; }
    </style><div class="t" role="status"><span>🐞 <b>LeetCode-Debugger ${String(m.to || '').replace(/[^\w.-]/g, '')}</b> ist da.
      Neu laden, um ihn zu nutzen.</span><button class="go">Neu laden</button><button class="x" title="Später">✕</button></div>`;
    host.shadowRoot.querySelector('.go').onclick = () => location.reload();
    host.shadowRoot.querySelector('.x').onclick = () => host.remove();
  }
})();
