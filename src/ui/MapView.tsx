import { CHAPTERS, PLANNED, chapterDone, chapterUnlocked } from "../levels/index";
import { KIND_LABEL, kindOf } from "../levels/types";
import { useSave } from "./store";

export function MapView({ open }: { open: (id: string) => void }) {
  const save = useSave();
  const next = CHAPTERS.flatMap((c) => (chapterUnlocked(c, save.passed, save.unlockAll) ? c.levels : [])).find((l) => !save.passed[l.id]);
  return (
    <div className="map">
      <h1>Bring up the board, one register at a time</h1>
      <p className="map-intro">
        Each chapter follows the same path: a short briefing, hands-on puzzles, then real C code on a simulated F28379D. Finish a chapter to unlock the next. Everything is saved on this computer.
      </p>
      {next && (
        <p>
          <button className="btn primary" onClick={() => open(next.id)}>
            {Object.keys(save.passed).length ? "Continue" : "Start"}: {next.title}
          </button>
        </p>
      )}
      <div className="chapters">
        {CHAPTERS.map((c) => {
          const unlocked = chapterUnlocked(c, save.passed, save.unlockAll);
          const done = chapterDone(c, save.passed);
          const n = c.levels.filter((l) => save.passed[l.id]).length;
          return (
            <section key={c.id} className={`chapter ${unlocked ? "" : "locked"} ${done ? "done" : ""}`} aria-labelledby={`ch-${c.id}`}>
              <div className="chapter-head">
                <span className="chapter-num">{String(c.number).padStart(2, "0")}</span>
                <h2 id={`ch-${c.id}`}>{c.title}</h2>
                <span className="spacer" />
                {done && <span className="badge ok">Done</span>}
              </div>
              <p className="chapter-blurb">{c.blurb}</p>
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.levels.length} aria-valuenow={n} aria-label={`${n} of ${c.levels.length} levels passed`}>
                <span style={{ width: `${(100 * n) / c.levels.length}%` }} />
              </div>
              {!unlocked && (
                <p className="lock-note">
                  Locked: finish {c.requires.map((r) => CHAPTERS.find((x) => x.id === r)?.title).join(" and ")} first.
                </p>
              )}
              <ol className="level-list">
                {c.levels.map((l) => (
                  <li key={l.id}>
                    <button className={`level-row ${save.passed[l.id] ? "passed" : ""}`} disabled={!unlocked} onClick={() => open(l.id)}>
                      <span className="mark" aria-hidden="true">{save.passed[l.id] ? "✓" : "·"}</span>
                      <span>
                        {l.title}
                        <span className="sr-only">{save.passed[l.id] ? " (passed)" : ""}</span>
                      </span>
                      <span className="kind">{KIND_LABEL[kindOf(l)]}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <p className="chapter-course">Course material: {c.course.join(", ")}</p>
            </section>
          );
        })}
        {PLANNED.map((p) => (
          <section key={p.number} className="chapter locked" aria-label={`Chapter ${p.number}, ${p.title}, coming in a later release`}>
            <div className="chapter-head">
              <span className="chapter-num">{String(p.number).padStart(2, "0")}</span>
              <h2>{p.title}</h2>
              <span className="spacer" />
              <span className="badge">Coming</span>
            </div>
            <p className="chapter-blurb">{p.blurb}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
