import { CHAPTERS, PLANNED, chapterDone, chapterUnlocked } from "../levels/index";
import { KIND_LABEL, kindOf, tierOf, type Chapter, type Level } from "../levels/types";
import { useSave, type Save } from "./store";

/** The campaign in four parts, by chapter number. */
const PARTS: { title: string; blurb: string; from: number; to: number }[] = [
  { title: "Foundations", blurb: "Bits, registers, pins, timers, interrupts and the serial port.", from: 0, to: 6 },
  { title: "Analog and motion", blurb: "Voltages in and out, PWM, motors and encoders.", from: 7, to: 11 },
  { title: "Buses and data", blurb: "SPI, I2C, CAN, DMA and digital filters.", from: 12, to: 15 },
  { title: "The robot", blurb: "Control, sensing, localization, vision and planning.", from: 16, to: 20 },
];

const starsOf = (l: Level): number => (l.kind === "code" ? (l.bonus?.length ?? 0) : 0);

function LevelRow({ l, save, unlocked, open }: { l: Level; save: Save; unlocked: boolean; open: (id: string) => void }) {
  const total = starsOf(l);
  const got = save.stars[l.id]?.length ?? 0;
  const tier = tierOf(l);
  return (
    <li>
      <button className={`level-row ${save.passed[l.id] ? "passed" : ""} tier-${tier}`} data-level={l.id} disabled={!unlocked} onClick={() => open(l.id)}>
        <span className="mark" aria-hidden="true">{save.passed[l.id] ? "✓" : tier === "expert" ? "◆" : "·"}</span>
        <span>
          {l.title}
          <span className="sr-only">{save.passed[l.id] ? " (passed)" : ""}</span>
          {total > 0 && (
            <span className="stars" aria-label={`${got} of ${total} stars`}>
              {" "}
              {"★".repeat(got)}
              <span className="empty">{"★".repeat(total - got)}</span>
            </span>
          )}
        </span>
        <span className="kind">{KIND_LABEL[kindOf(l)]}</span>
      </button>
    </li>
  );
}

function ChapterCard({ c, save, open }: { c: Chapter; save: Save; open: (id: string) => void }) {
  const unlocked = chapterUnlocked(c, save.passed, save.unlockAll);
  const done = chapterDone(c, save.passed);
  const core = c.levels.filter((l) => tierOf(l) === "core");
  const practice = c.levels.filter((l) => tierOf(l) === "practice");
  const expert = c.levels.filter((l) => tierOf(l) === "expert");
  const n = core.filter((l) => save.passed[l.id]).length;
  const extra = [...practice, ...expert].filter((l) => save.passed[l.id]).length;
  const starTotal = c.levels.reduce((s, l) => s + starsOf(l), 0);
  const starGot = c.levels.reduce((s, l) => s + (save.stars[l.id]?.length ?? 0), 0);
  const allDone = done && extra === practice.length + expert.length;
  return (
    <section className={`chapter ${unlocked ? "" : "locked"} ${done ? "done" : ""}`} aria-labelledby={`ch-${c.id}`}>
      <div className="chapter-head">
        <span className="chapter-num">{String(c.number).padStart(2, "0")}</span>
        <h3 id={`ch-${c.id}`}>{c.title}</h3>
        <span className="spacer" />
        {allDone ? <span className="badge ok">Mastered</span> : done ? <span className="badge ok">Done</span> : null}
      </div>
      <p className="chapter-blurb">{c.blurb}</p>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={core.length} aria-valuenow={n} aria-label={`${n} of ${core.length} core levels passed`}>
        <span style={{ width: `${(100 * n) / Math.max(1, core.length)}%` }} />
      </div>
      <p className="chapter-stats">
        {n}/{core.length} core
        {practice.length + expert.length > 0 && ` · ${extra}/${practice.length + expert.length} extra`}
        {starTotal > 0 && ` · ★ ${starGot}/${starTotal}`}
      </p>
      {!unlocked && (
        <p className="lock-note">
          Locked: finish {c.requires.map((r) => CHAPTERS.find((x) => x.id === r)?.title ?? r).join(" and ")} first.
        </p>
      )}
      <details open={unlocked && !allDone}>
        <summary>Levels</summary>
        <ol className="level-list">
          {core.map((l) => (
            <LevelRow key={l.id} l={l} save={save} unlocked={unlocked} open={open} />
          ))}
        </ol>
        {practice.length > 0 && (
          <>
            <h4 className="tier-head practice">More practice</h4>
            <ol className="level-list">
              {practice.map((l) => (
                <LevelRow key={l.id} l={l} save={save} unlocked={unlocked} open={open} />
              ))}
            </ol>
          </>
        )}
        {expert.length > 0 && (
          <>
            <h4 className="tier-head expert">Expert challenges</h4>
            <ol className="level-list">
              {expert.map((l) => (
                <LevelRow key={l.id} l={l} save={save} unlocked={unlocked} open={open} />
              ))}
            </ol>
          </>
        )}
      </details>
      <p className="chapter-course">Course material: {c.course.join(", ")}</p>
    </section>
  );
}

export function MapView({ open }: { open: (id: string) => void }) {
  const save = useSave();
  const next = CHAPTERS.flatMap((c) => (chapterUnlocked(c, save.passed, save.unlockAll) ? c.levels.filter((l) => tierOf(l) === "core") : [])).find((l) => !save.passed[l.id]);
  return (
    <div className="map">
      <h1>Bring up the board, one register at a time</h1>
      <p className="map-intro">
        Each chapter follows the same path: a short briefing, hands-on puzzles, then real C code on a simulated F28379D. The core levels of a chapter unlock the next ones. Practice levels and expert challenges (◆) are optional, and code levels offer stars (★) for tighter or lower-level solutions. Everything is saved on this computer.
      </p>
      {next && (
        <p>
          <button className="btn primary" onClick={() => open(next.id)}>
            {Object.keys(save.passed).length ? "Continue" : "Start"}: {next.title}
          </button>
        </p>
      )}
      {PARTS.map((part) => {
        const chapters = CHAPTERS.filter((c) => c.number >= part.from && c.number <= part.to);
        const planned = PLANNED.filter((p) => p.number >= part.from && p.number <= part.to);
        if (!chapters.length && !planned.length) return null;
        return (
          <section key={part.title} className="part" aria-labelledby={`part-${part.from}`}>
            <div className="part-head">
              <h2 id={`part-${part.from}`}>{part.title}</h2>
              <p>{part.blurb}</p>
            </div>
            <div className="chapters">
              {chapters.map((c) => (
                <ChapterCard key={c.id} c={c} save={save} open={open} />
              ))}
              {planned.map((p) => (
                <section key={p.number} className="chapter locked" aria-label={`Chapter ${p.number}, ${p.title}, coming in a later release`}>
                  <div className="chapter-head">
                    <span className="chapter-num">{String(p.number).padStart(2, "0")}</span>
                    <h3>{p.title}</h3>
                    <span className="spacer" />
                    <span className="badge">Coming</span>
                  </div>
                  <p className="chapter-blurb">{p.blurb}</p>
                </section>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
