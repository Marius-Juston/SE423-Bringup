import { useRef, useState } from "react";
import { store, useSave } from "./store";

export function Settings() {
  const save = useSave();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  return (
    <div className="map" style={{ maxWidth: 720 }}>
      <h1>Settings</h1>
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
