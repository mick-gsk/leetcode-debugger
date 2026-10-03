/* Startet die Engine in der Sandbox. Die Seite (host.js) antwortet auf „hello“ mit dem Code aus
 * dem GitHub-Stand; fehlt der, oder läuft er nicht, kommen die Dateien aus dem Paket.
 * Die Sandbox hat einen eigenen, leeren Ursprung: eval ist hier erlaubt und kann nichts erreichen. */
(() => {
  'use strict';
  const PACKAGED = ['vendor/acorn.js', 'tracer.js', 'engine.js'];
  let booted = false;

  function loadPackaged(i) {
    if (i >= PACKAGED.length) return;
    const s = document.createElement('script');
    s.src = PACKAGED[i];
    s.onload = () => loadPackaged(i + 1);
    document.body.appendChild(s);
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (booted || e.source !== window.parent || !m || !m.lcdbg || m.type !== 'boot') return;
    booted = true;
    if (Array.isArray(m.files) && m.files.length) {
      try {
        for (const f of m.files) (0, eval)(String(f.code) + '\n//# sourceURL=lcdbg-engine/' + f.name);
        return;
      } catch (err) {
        console.error('[LeetCode-Debugger] Engine aus GitHub startet nicht, nehme das Paket:', err);
        delete window.LCTracer;
      }
    }
    loadPackaged(0);
  });

  window.parent.postMessage({ lcdbg: true, type: 'hello' }, '*');
})();
