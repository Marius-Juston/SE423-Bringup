import { useRef, useState } from "react";
import { store, useSave } from "./store";
import { usePref } from "./prefs";

export function Settings() {
  const file = useRef<HTMLInputElement>(null);
  // The text below shows the progress as it is now, also after another window of the game saved.
  useSave();
  const [note, setNote] = useState<{ text: string; ok: boolean }>({ text: "", ok: true });
  const setMsg = (text: string, ok = true) => setNote({ text, ok });
  const TOO_LARGE = "That progress is too large to store in this browser. Your progress from before is kept.";
  const [theme, setTheme] = usePref<"system" | "light" | "dark">("theme", "system");
  const [scale, setScale] = usePref<number>("text-scale", 1);
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="map settings">
      <h1>Settings</h1>
      <section>
        <h2>Appearance</h2>
        <div className="setting-row">
          <label htmlFor="set-theme">Theme</label>
          <select id="set-theme" value={theme} onChange={(e) => setTheme(e.target.value as "system" | "light" | "dark")}>
            <option value="system">Same as this computer</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="setting-row">
          <label htmlFor="set-scale">Text size</label>
          <select id="set-scale" value={scale} onChange={(e) => setScale(+e.target.value)}>
            <option value={0.9}>Small</option>
            <option value={1}>Normal</option>
            <option value={1.15}>Large</option>
            <option value={1.3}>Extra large</option>
          </select>
        </div>
        <p className="hint-text">Animations follow this computer's "reduce motion" setting.</p>
      </section>
      <section>
        <h2>Keyboard</h2>
        <table className="fields keys">
          <thead>
            <tr><th scope="col">Keys</th><th scope="col">What they do</th></tr>
          </thead>
          <tbody>
            <tr><td><kbd>Ctrl</kbd> <kbd>Enter</kbd></td><td>Run the level's tests</td></tr>
            <tr><td><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Enter</kbd></td><td>Run or stop the program</td></tr>
            <tr><td><kbd>F10</kbd></td><td>Run one line, then pause</td></tr>
            <tr><td><kbd>F9</kbd></td><td>Run to the next register write, then pause</td></tr>
            <tr><td><kbd>Esc</kbd> then <kbd>Tab</kbd></td><td>Leave the code editor</td></tr>
            <tr><td><kbd>←</kbd> <kbd>→</kbd> <kbd>Home</kbd> <kbd>End</kbd> on a divider</td><td>Resize panes (<kbd>Enter</kbd> resets)</td></tr>
            <tr><td><kbd>←</kbd> <kbd>→</kbd> on the map</td><td>Move between chapters; <kbd>Tab</kbd> goes to the chapter's levels</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2>Chapters</h2>
        <p className="hint-text">Every chapter is open. The map recommends an order and marks what to do first; to practise for a lab or homework, pick it under "Working on" on the map.</p>
      </section>
      <section>
        <h2>Your progress</h2>
        <p className="hint-text">Progress and code are saved on this computer only. Export a file to move to another computer or keep a backup.</p>
        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([store.export()], { type: "application/json" }));
              a.download = "bringup-progress.json";
              a.click();
              URL.revokeObjectURL(a.href);
              setMsg("Progress exported.");
            }}
          >
            Export progress
          </button>
          <button className="btn" onClick={() => file.current?.click()}>Import progress</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Progress file to import"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = store.import(await f.text());
              setMsg(r === "ok" ? "Progress imported." : r === "too-large" ? TOO_LARGE : "That file is not a Bringup progress file. Your progress is unchanged.", r === "ok");
              e.target.value = "";
            }}
          />
          <button
            className="btn ghost"
            onClick={() => {
              if (window.confirm("Erase all progress and saved code on this computer?")) {
                store.reset();
                setMsg("Progress erased.");
              }
            }}
          >
            Erase progress
          </button>
        </div>
        <p role="status" className={`verdict ${note.ok ? "ok" : "bad"}`}>{note.text}</p>
        <details>
          <summary>Copy and paste instead of using a file</summary>
          <p className="hint-text">Copy this text to save your progress. To restore, paste saved text here and press Load.</p>
          <label className="sr-only" htmlFor="save-text">Progress as text</label>
          <textarea id="save-text" value={text ?? store.export()} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} style={{ width: "100%", fontFamily: "var(--mono)", fontSize: "0.8rem" }} />
          <div className="actions">
            <button
              className="btn"
              onClick={() => {
                const r = store.import(text ?? "");
                setMsg(r === "ok" ? "Progress loaded." : r === "too-large" ? TOO_LARGE : "That text is not Bringup progress. Check that you pasted all of it. Your progress is unchanged.", r === "ok");
                // A text that did not load stays, so it can be corrected.
                if (r === "ok") setText(null);
              }}
              disabled={text === null}
            >
              Load
            </button>
          </div>
        </details>
      </section>
      <section>
        <h2>About</h2>
        <p className="hint-text">
          Bringup is a practice game for SE 423 (Introduction to Mechatronics, University of Illinois). Register definitions and helper functions come from Texas Instruments C2000Ware (BSD-3-Clause). Levels cite the TMS320F2837xD Technical Reference Manual (SPRUHM8I). The simulator models behaviour, not exact timing: always confirm on the real board.
        </p>
      </section>
    </div>
  );
}
