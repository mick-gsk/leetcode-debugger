# LeetCode-Debugger

Chrome-Extension, die einen Debugger **wie in VS Code direkt in den LeetCode-Editor** einbaut. Oben
rechts im Editor sitzt ein Knopf **🐞 Debuggen**. Nach dem Klick erscheint dort die von VS Code
bekannte kompakte Debug-Leiste. Der Editor bekommt oben etwas Abstand, damit sie keinen Code
verdeckt.

- **Haltepunkte:** Klick links neben die Zeilennummer setzt einen roten Punkt, **▷ Weiter (F5)**
  läuft bis dorthin.
- **Aktuelle Zeile:** gelb hinterlegt, mit gelbem Pfeil in der Randspalte.
- **Inline-Werte wie in VS Code:** Neben den Zeilen der aktuellen Funktion steht in grau, welche Werte
  die Variablen gerade haben (`x = 4`). Mit der Maus über einer Variable siehst du ihren Wert.
- **Fehler** erscheinen wie in VS Code als roter Kasten *unter* der Fehlerzeile, mit Hinweis.
- **Variablen, Aufrufstapel, Ausgabe (`console.log`) und Testaufruf** klappen über ({x}) auf.
- **Auch im Fokus-Modus (🧘):** Dort nutzt LeetCode CodeMirror statt Monaco. Die Leiste sitzt
  trotzdem oben rechts am Editor, mit aktueller Zeile, Inline-Werten und Sprung zur Fehlerzeile.
- **Gescheiterte Einsendung:** Scheitert „Submit“ an einem versteckten Testfall, merkt sich der
  Debugger genau diesen Fall (Eingabe + erwartet). Der Knopf wird rot (**🐞 Fehlschlag debuggen**),
  und ein Klick springt direkt in diesen Fall – auch wenn alle Beispiele stimmen.
- **Kein neues Paket mehr:** Die Extension liest ihren Code bei jedem Seitenaufruf frisch aus dem
  Ordner. Neuer Stand im Ordner → LeetCode-Seite neu laden (F5), fertig.

Der Code läuft dabei lokal im Browser und wird Schritt für Schritt aufgezeichnet. Deshalb geht
anders als in VS Code auch **rückwärts**.

## Installieren (einmalig, 2 Minuten)

1. [Code als ZIP herunterladen](https://github.com/mick-gsk/leetcode-debugger/archive/refs/heads/main.zip)
   und an einen **festen Ort** entpacken (z. B. `Dokumente\leetcode-debugger`). Den Ordner danach
   nicht mehr verschieben: Chrome lädt die Extension von genau dort.
   *Mit Git geht auch:* `git clone https://github.com/mick-gsk/leetcode-debugger.git`
2. In Chrome `chrome://extensions` öffnen, oben rechts **Entwicklermodus** einschalten.
3. Eine alte LeetCode-Debugger-Version dort **entfernen** (Testaufrufe bleiben erhalten, die liegen
   bei LeetCode im Browser).
4. **„Entpackte Erweiterung laden“** → den entpackten Ordner wählen (der, in dem `manifest.json` liegt).
5. Bei der Extension auf **„Details“** → **„Nutzerskripts zulassen“** einschalten. Dann kommen
   Updates von selbst (siehe unten).
6. LeetCode-Aufgabe öffnen oder neu laden. Oben rechts im Editor erscheint **🐞 Debuggen**.

Funktioniert auch in Edge und Brave, ab Chrome 120. Auf einem Firmenrechner kann eine Richtlinie
den Entwicklermodus sperren. Dann lässt sich die Extension dort nicht entpackt laden.

## Aktualisieren – ohne neues Paket

**Aus GitHub, automatisch:** Ist „Nutzerskripts zulassen“ an, fragt die Extension beim Öffnen einer
LeetCode-Seite GitHub nach dem neuesten Stand (höchstens alle paar Minuten; unveränderte Stände
kosten dank bedingter Anfragen kein Limit). Ist dort eine **höhere Version** als im Ordner, lädt sie
den Debugger-Code daraus. Ein Hinweis sagt dann: Seite neu laden (F5). Ein Token ist nicht nötig,
das Repo ist öffentlich. Das Fenster am Käfer-Symbol zeigt, welche Version läuft und woher (Ordner
oder GitHub-Stand). Passen alter Rahmen und neuer Code nicht mehr zusammen, sagt es „braucht einmal
ein neues Paket“: dann den Ordner neu herunterladen bzw. `git pull`, und in `chrome://extensions`
auf **↻ Aktualisieren**.

**Aus dem Ordner (beim Entwickeln):** Der Hintergrund spielt den Debugger-Code bei **jedem
Seitenaufruf frisch aus dem Ordner** ein (`scripting.executeScript` liest die Datei jedes Mal von der
Platte, fest angemeldete Content-Scripts dagegen erst nach „Aktualisieren“). Deshalb:

| Was hat sich geändert? | Was tun? |
|---|---|
| Debugger-Code (`ui.js`, `page.js`, `host.js`, `net.js`, `engine.js`, `tracer.js`, `update.json`) | **LeetCode-Seite neu laden (F5)** |
| Rahmen (`manifest.json`, `background.js`, `content.js`, `popup.*`) | in `chrome://extensions` beim Debugger auf **↻ Aktualisieren**, dann F5 |

Der Ordner gewinnt immer, außer GitHub hat eine strikt höhere Version.

**Eigener Fork oder privates Repo:** Im Fenster am Käfer-Symbol unter **„Quelle (GitHub)“** Repo,
Zweig und Unterordner (leer = Wurzel) eintragen. Für ein privates Repo zusätzlich ein Token
([fein abgestuft](https://github.com/settings/personal-access-tokens/new): nur dieses Repo,
„Contents: Read-only“, mit Ablaufdatum).

## Knopf erscheint nicht?

**Klick auf das Käfer-Symbol** oben in der Chrome-Leiste. Ist es nicht sichtbar, steckt es unter dem
Puzzle-Symbol; dort kannst du es auch anheften. Das Fenster startet den Debugger direkt und prüft dabei:

- **Läuft die Extension in diesem Tab?** Wenn nicht, die Seite mit `F5` neu laden. Hilft das nicht:
  Rechtsklick auf das Käfer-Symbol → „Kann Websitedaten lesen und ändern“ → „Auf leetcode.com“.
- **Ist die Seite eine Aufgabenseite?** Die Adresse muss `/problems/…` sein.
- **Findet sie den Code-Editor?** Wenn nicht, sitzt der Knopf unten rechts im Fenster.
- **Wird der Knopf angezeigt, oder verdeckt ihn etwas?** Das Fenster nennt dann das verdeckende Element.

Zusätzlich schreibt die Extension in die Konsole (`F12` → Konsole, Filter `LeetCode-Debugger`).

## Benutzen

1. **🐞 Debuggen** im Editor klicken, `Alt+Shift+D` drücken oder das Käfer-Symbol in der Chrome-Leiste
   → „Debugger starten“. Alle Beispiele aus dem Aufgabentext werden sofort geprüft.
2. In der Leiste steht links der Testfall (✓ / ✗ / !). Ein Klick darauf zeigt alle Beispiele und
   „+ Eigener Test“. Darunter steht das Ergebnis, z. B. `Beispiel 1: falsches Ergebnis · erwartet
   false · bekommen undefined`, und in der dritten Zeile, was als Nächstes passiert.
3. Durchgehen wie in VS Code:

| Symbol | Taste | Wirkung |
|---|---|---|
| ▷ Weiter | `F5` | bis zum nächsten Haltepunkt (ohne Haltepunkt: bis zum Ende) |
| ↷ Prozedurschritt | `F10` | nächste Zeile, Aufrufe werden übersprungen |
| ↓ Einzelschritt | `F11` | nächster Schritt, auch in Funktionen hinein |
| ↑ Rücksprung | `Shift+F11` | bis die aktuelle Funktion fertig ist |
| ↶ Zurück | `Alt+Shift+←` | einen Schritt zurück (gibt es in VS Code nicht) |
| ⟳ Neu starten | `Strg+Shift+F5` | Code neu holen, alle Beispiele neu prüfen |
| ■ Beenden | `Shift+F5` | Debugger schließen, Editor wie vorher |
| Haltepunkt | `F9` oder Klick in die Randspalte | Haltepunkt an der Cursor-Zeile setzen/entfernen |
| Regler | – | zu einem beliebigen Schritt springen |

Die Tasten gelten nur, solange der Debugger offen ist. Danach lädt `F5` wie gewohnt die Seite neu.
`F11` schaltet in manchen Chrome-Versionen trotzdem auf Vollbild; dann den Knopf oder `Alt+Shift+→`
nehmen.

**Gescheiterte Einsendung:** Zeigt LeetCode nach „Submit“ *Wrong Answer*, *Runtime Error* oder
*Time Limit Exceeded*, liest der Debugger den Testfall mit (aus LeetCodes Antwort, sonst aus dem
sichtbaren Ergebnisfeld beim Start). Er steht im Testfall-Menü unter **„Gescheitert bei LeetCode“**,
mit ✕ zum Entfernen. Pro Aufgabe bleiben die letzten drei. Liefert derselbe Code lokal das richtige
Ergebnis, bei LeetCode aber nicht, sagt die Leiste das ausdrücklich. Häufigste Ursache sind dann
Variablen außerhalb der Funktion, die zwischen LeetCodes Testfällen ihren Wert behalten.

**Testaufruf:** wird aus dem Beispiel geraten, z. B. `compose(functions)(x);`. Passt er nicht
zur Aufgabe, über ({x}) → **Testaufruf** ändern. Die letzte Zeile ist das Ergebnis, das mit „erwartet“
verglichen wird. Änderungen werden pro Aufgabe gespeichert.

**Die Methode:** Bei einem falschen Ergebnis einen Haltepunkt auf die verdächtige Zeile setzen, mit ▷
dorthin springen und die Werte neben dem Code mit deiner Erwartung vergleichen. Oder ans Ende
springen und mit ↶ rückwärts gehen. Der **erste** Wert, der nicht stimmt, zeigt auf den Fehler.

## Was es kann

- **Variablen:** pro Schritt, getrennt in *lokal* und *Closure*, mit vorherigem Wert bei Änderungen.
- **Aufrufe und Rückgaben:** als eigene Schritte, dazu die Aufrufkette.
- **Fehler:** mit Zeile (im Editor rot) und deutschem Hinweis für die häufigsten Fälle – sichtbar in
  der Leiste, nicht nur im Tooltip. Auch Fehler, die LeetCodes Prüf-Code abfängt (z. B. bei
  „To Be Or Not To Be“ wird daraus sonst still `{"error": …}`): Der Debugger zeigt, welche Zeile
  geworfen hat, und springt dorthin.
- **Auffälligkeiten ohne Ausführen:** Fehler, die JavaScript still schluckt – eine Methode zweimal
  im selben Objekt (die zweite ersetzt die erste), ein Parameter, der den gleichnamigen äußeren
  verdeckt, `throw "Text"` statt `throw new Error("Text")`. Erscheinen nur, wenn ein Beispiel scheitert.
- **Endlosschleifen und Rekursion ohne Ende:** werden abgebrochen, statt den Tab einzufrieren.
- **Async:** Promises, `async`/`await`, `setTimeout`/`setInterval`.
- **Aufgabentypen:** Funktionen (auch solche, die Funktionen zurückgeben), `Array.prototype.…`,
  Klassen im Design-Format (auch `X.prototype.…`), `ListNode`/`TreeNode`.
- **„30 Days of JavaScript“:** Für alle 30 Aufgaben baut der Testaufruf LeetCodes eigenen Prüf-Code
  nach (Aktionslisten wie `calls = ["call","call"]`, Zeitmessung, Hüllen wie `{"value": …}`).
  Zeiten werden mit ±25 ms verglichen. Gemessen: 84 von 84 Beispielen mit Musterlösungen.
- **Ausgaben:** `console.log` erscheint im Reiter *Ausgabe*. Ein Klick springt zu der Stelle, an der
  die Ausgabe passiert ist.

## Grenzen (ehrlich)

- **Nur JavaScript.**
- **Fokus-Modus mit weniger Komfort:** Haltepunkte per Klick und der rote Fehlerkasten unter der Zeile
  gibt es nur im normalen Layout; im Fokus-Modus steht der Fehler in der Leiste, die Zeile ist rot hinterlegt.
- **Der Testaufruf ist geraten.** Bei Standardformen und den „30 Days“ trifft er. Bei
  anderen Aufgaben mit eigenem Eingabeformat musst du ihn anpassen.
- **Kein Ersatz für Submit:** Der Code läuft lokal, nicht auf dem LeetCode-Server. Die versteckten
  Testfälle und Zeitlimits von LeetCode werden nicht geprüft.
- **Teilweise am echten LeetCode bestätigt:** Editor-Widget, Zeilenmarkierung, Inline-Werte und
  das Nachladen per F5 laufen auf leetcode.com. Neu und nur gegen Nachbauten getestet: das Mithören bei „Submit“
  (LeetCodes Antwortformat ist nicht dokumentiert und nicht live gesehen; als Rückfall wird das
  sichtbare Ergebnisfeld gelesen) und das Selbst-Update gegen einen Nachbau der GitHub-API.
  Kommt der Code nicht aus dem Editor (`window.monaco` fehlt), erscheint ein Feld zum Einfügen.

## Sicherheit / Datenschutz

- **Berechtigungen:** läuft nur auf `leetcode.com` und `leetcode.cn`. Dazu `api.github.com` (Updates
  holen), `storage` (Token, Einstellungen, geladener Stand), `scripting` und `userScripts` (den
  Debugger-Code in die LeetCode-Seite einhängen).
- **GitHub-Update heißt:** Mit „Nutzerskripts zulassen“ führt die Extension aus, was im Zweig
  `main` von `mick-gsk/leetcode-debugger` liegt (nur Debugger-Code, nur auf LeetCode-Seiten). Wer
  dem nicht traut, lässt den Schalter aus: Dann läuft ausschließlich der Code im eigenen Ordner. Ein
  fremdes Repo unter „Quelle“ wäre fremder Code – nur eintragen, wenn du ihm traust.
- **Token (nur für private Repos):** liegt nur im Speicher der Extension in diesem Chrome-Profil,
  Webseiten kommen nicht heran, und es geht nur an `api.github.com`. Deshalb: nur „Contents:
  Read-only“, nur dieses eine Repo, mit Ablaufdatum. „Token löschen“ im Fenster entfernt es.
- **Ausführung:** Dein Code läuft in einer unsichtbaren Sandbox-Seite der Extension. Die hat einen
  eigenen, leeren Ursprung, also keinen Zugriff auf LeetCode-Cookies, andere Seiten oder
  Chrome-APIs.
- **Mithören bei Submit:** `net.js` liest nur LeetCodes Antworten auf Einsendungen, ändert nichts und
  schickt nichts weiter. Der Testfall bleibt im Browser (`localStorage` von LeetCode).
- **Netzwerk sonst:** Ist der Aufgabentext nicht im DOM, wird er über LeetCodes eigene
  GraphQL-Schnittstelle nachgeladen.

## Aufbau

Zwei Teile: ein **fester Rahmen**, den Chrome beim Laden der Extension einliest, und der
**Debugger-Code**, den der Rahmen bei jedem Seitenaufruf frisch aus dem Ordner einspielt (oder, bei höherer
Version, aus GitHub).

| Datei | Teil | Rolle |
|---|---|---|
| `manifest.json` | Rahmen | Manifest V3, `engine.html` als Sandbox-Seite |
| `background.js` | Rahmen | Spielt den Debugger-Code bei jedem Seitenaufruf frisch aus dem Ordner ein (`chrome.scripting.executeScript`); optional: prüft GitHub auf höhere Versionen (bedingte Anfragen, 304 kostet kein Limit) und meldet sie per `chrome.userScripts` an |
| `content.js` | Rahmen | Sagt dem Debugger, wo die Extension liegt, meldet Seitenaufrufe, reicht Anfragen des Fensters weiter, zeigt den Update-Hinweis |
| `engine.html`, `boot.js` | Rahmen | Sandbox: startet die Engine aus dem GitHub-Stand, sonst aus dem Ordner |
| `popup.html/.js` | Rahmen | Fenster am Käfer-Symbol: Debugger starten, Zustand prüfen, Aktualisierung, Quelle + Token |
| `update.json` | – | Welche Dateien zum Debugger-Code gehören, in welcher Reihenfolge; `shell` = nötige Rahmen-Version |
| `net.js` | Code | Hört bei „Submit“ mit und merkt sich den gescheiterten Testfall |
| `host.js` | Code | Vermittler zwischen Engine und Seite, Aufgabentext, Entwürfe, Einsendungen, Tastenkürzel |
| `page.js` | Code | Läuft in der Seite, weil nur dort `window.monaco` sichtbar ist: Code lesen, Zeile markieren, Werte am Zeilenende, Hover, Knopf + Leiste als **Monaco-Overlay-Widget** |
| `ui.js` | Code | Knopf und Debug-Leiste im VS-Code-Stil (Shadow DOM); zeichnet nur das Ansichtsmodell der Engine |
| `engine.js` | Code | Zustand, Testfälle, Läufe, Schritte; schickt ein fertiges Ansichtsmodell |
| `tracer.js` | Code | Kern: instrumentiert den Code mit Acorn, führt ihn aus, formatiert Werte, liest Beispiele und Ergebnisfelder, rät den Testaufruf, vergleicht |
| `vendor/acorn.js` | Code | JavaScript-Parser (MIT, Version 8.18.0) |

Die Instrumentierung fügt nur Text ohne Zeilenumbrüche ein, deshalb bleiben die Zeilennummern
identisch mit dem Editor.

**Für Änderungen gilt:** Ändert sich nur Debugger-Code, reicht F5. Version in `manifest.json`
hochzählen, wenn der Stand nach `main` geht (sonst holt ein Rechner mit GitHub-Update ihn nicht ab). Ändert sich der Rahmen so, dass alter
Rahmen und neuer Code nicht mehr zusammenpassen, `shell` in `update.json` und `SHELL` in
`background.js` erhöhen: Dann wartet der alte Rahmen auf ein neues Paket, statt halb zu laufen.

## Tests

```bash
node test/tracer.test.js                              # Kern: 28 Fälle
NODE_PATH=$(npm root -g) node test/e2e.js [bild.png]  # Extension in Chromium gegen LeetCode- und GitHub-Nachbau: 29 Abläufe
```
