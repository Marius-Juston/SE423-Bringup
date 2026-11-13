import { useRef, useState } from "react";
import { store, useSave } from "./store";
import { usePref } from "./prefs";

export function Settings() {
  const save = useSave();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const [theme, setTheme] = usePref<"system" | "light" | "dark">("theme", "system");
  const [scale, setScale] = usePref<number>("text-scale", 1);
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="map" style={{ maxWidth: 720 }}>
      <h1>Settings</h1>
      <section style={{ marginTop: "1.5rem" }}>
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
        <p style={{ color: "var(--dim)", fontSize: "0.9rem" }}>Animations follow this computer's "reduce motion" setting.</p>
      </section>
      <section style={{ marginTop: "1.5rem" }}>
        <h2>Keyboard</h2>
        <table className="fields" style={{ maxWidth: 520 }}>
          <tbody>
            <tr><td><kbd>Ctrl</kbd> <kbd>Enter</kbd></td><td>Run the level's tests</td></tr>
            <tr><td><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Enter</kbd></td><td>Run or stop the program</td></tr>
            <tr><td><kbd>F10</kbd></td><td>Step one line (while running)</td></tr>
            <tr><td><kbd>F9</kbd></td><td>Run to the next register write</td></tr>
            <tr><td><kbd>Esc</kbd> then <kbd>Tab</kbd></td><td>Leave the code editor</td></tr>
            <tr><td><kbd>←</kbd> <kbd>→</kbd> on a divider</td><td>Resize panes</td></tr>
          </tbody>
        </table>
      </section>
      <section style={{ marginTop: "1.5rem" }}>
        <h2>Chapters</h2>
        <label className="option" style={{ marginTop: "0.5rem" }}>
          <input type="checkbox" checked={save.unlockAll} onChange={(e) => store.setUnlockAll(e.target.checked)} />
          <span>
            Unlock every chapter
            <br />
            <span style={{ color: "var(--dim)", fontSize: "0.9rem" }}>Useful when you want to practise one topic for this week's lab or homework without playing the earlier chapters first.</span>
          </span>
        </label>
      </section>
      <section style={{ marginTop: "1.5rem" }}>
        <h2>Your progress</h2>
        <p style={{ color: "var(--dim)" }}>Progress and code are saved on this computer only. Export a file to move to another computer or keep a backup.</p>
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
            aria-label="Progress file to import"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setMsg(store.import(await f.text()) ? "Progress imported." : "That file is not a Bringup progress file.");
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
        <p role="status" style={{ color: "var(--ok)", minHeight: "1.5em" }}>{msg}</p>
        <details>
          <summary>Copy and paste instead of using a file</summary>
          <p style={{ color: "var(--dim)", marginTop: "0.5rem" }}>Copy this text to save your progress. To restore, paste saved text here and press Load.</p>
          <label className="sr-only" htmlFor="save-text">Progress as text</label>
          <textarea id="save-text" value={text ?? store.export()} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} style={{ width: "100%", fontFamily: "var(--mono)", fontSize: "0.8rem" }} />
          <div className="actions">
            <button
              className="btn"
              onClick={() => {
                setMsg(store.import(text ?? "") ? "Progress loaded." : "That text is not Bringup progress.");
                setText(null);
              }}
              disabled={text === null}
            >
              Load
            </button>
          </div>
        </details>
      </section>
      <section style={{ marginTop: "1rem" }}>
        <h2>About</h2>
        <p style={{ color: "var(--dim)" }}>
          Bringup is a practice game for SE 423 (Introduction to Mechatronics, University of Illinois). Register definitions and helper functions come from Texas Instruments C2000Ware (BSD-3-Clause). Levels cite the TMS320F2837xD Technical Reference Manual (SPRUHM8I). The simulator models behaviour, not exact timing: always confirm on the real board.
        </p>
      </section>
    </div>
  );
}
