import { CHAPTERS, PLANNED, chapterDone, chapterUnlocked } from "../levels/index";
import { KIND_LABEL, kindOf, tierOf, type Chapter, type Level } from "../levels/types";
import { useSave, type Save } from "./store";
import { usePref } from "./prefs";
import { Icon, Ring } from "./Icon";

/** The campaign in four parts, by chapter number. */
const PARTS: { title: string; blurb: string; from: number; to: number }[] = [
  { title: "Foundations", blurb: "Bits, registers, pins, timers, interrupts and the serial port.", from: 0, to: 6 },
  { title: "Analog and motion", blurb: "Voltages in and out, PWM, motors and encoders.", from: 7, to: 11 },
  { title: "Buses and data", blurb: "SPI, I2C, CAN, DMA and digital filters.", from: 12, to: 15 },
  { title: "The robot", blurb: "Control, sensing, localization, vision and planning.", from: 16, to: 20 },
];

const starsOf = (l: Level): number => (l.kind === "code" ? (l.bonus?.length ?? 0) : 0);
const coreOf = (c: Chapter) => c.levels.filter((l) => tierOf(l) === "core");

function LevelRow({ l, save, unlocked, open, current }: { l: Level; save: Save; unlocked: boolean; open: (id: string) => void; current: boolean }) {
  const total = starsOf(l);
  const got = save.stars[l.id]?.length ?? 0;
  const tier = tierOf(l);
  const passed = !!save.passed[l.id];
  return (
    <li>
      <button className={`level-row tier-${tier} ${passed ? "passed" : ""} ${current ? "current" : ""}`} data-level={l.id} disabled={!unlocked} onClick={() => open(l.id)}>
        <span className="node" aria-hidden="true">
          <Icon name={passed ? "check" : tier === "expert" ? "diamond" : "dot"} size={14} />
        </span>
        <span className="name">
          {l.title}
          <span className="sr-only">{passed ? ", passed" : current ? ", next up" : ""}</span>
          {total > 0 && (
            <span className="stars" aria-label={`${got} of ${total} stars`}>
              {Array.from({ length: total }, (_, i) => (
                <Icon key={i} name="star" size={11} />
              )).map((s, i) => (
                <span key={i} className={i < got ? "" : "empty"}>{s}</span>
              ))}
            </span>
          )}
        </span>
        <span className="kind">{KIND_LABEL[kindOf(l)]}</span>
      </button>
    </li>
  );
}

function ChapterDetail({ c, save, open, nextId }: { c: Chapter; save: Save; open: (id: string) => void; nextId?: string }) {
  const unlocked = chapterUnlocked(c, save.passed, save.unlockAll);
  const core = coreOf(c);
  const practice = c.levels.filter((l) => tierOf(l) === "practice");
  const expert = c.levels.filter((l) => tierOf(l) === "expert");
  const n = core.filter((l) => save.passed[l.id]).length;
  const first = c.levels.find((l) => !save.passed[l.id] && tierOf(l) === "core") ?? c.levels.find((l) => !save.passed[l.id]);
  const group = (title: string, cls: string, levels: Level[], note: string) =>
    levels.length > 0 && (
      <section className={`tier-group ${cls}`}>
        <h3>
          {title} <span>{levels.filter((l) => save.passed[l.id]).length}/{levels.length}</span>
        </h3>
        <p className="tier-note">{note}</p>
        <ol className="level-list">
          {levels.map((l) => (
            <LevelRow key={l.id} l={l} save={save} unlocked={unlocked} open={open} current={l.id === nextId} />
          ))}
        </ol>
      </section>
    );
  return (
    <aside className="chapter-detail" aria-labelledby="chapter-detail-title">
      <p className="eyebrow">Chapter {c.number}</p>
      <h2 id="chapter-detail-title">{c.title}</h2>
      <p className="chapter-blurb">{c.blurb}</p>
      <p className="chapter-course">Course material: {c.course.join(", ")}</p>
      {!unlocked ? (
        <p className="lock-note">
          <Icon name="lock" size={15} /> Locked. Finish the core levels of {c.requires.map((r) => CHAPTERS.find((x) => x.id === r)?.title ?? r).join(" and ")} first, or unlock everything in Settings.
        </p>
      ) : (
        first && (
          <button className="btn primary" onClick={() => open(first.id)}>
            <Icon name="play" size={14} /> {n === 0 ? "Start" : "Continue"}: {first.title}
          </button>
        )
      )}
      {group("Core path", "core", core, "These unlock the next chapters.")}
      {group("More practice", "practice", practice, "Optional: the same skills on new cases.")}
      {group("Expert challenges", "expert", expert, "Optional and hard: for going to the bottom of the topic.")}
    </aside>
  );
}

export function MapView({ open }: { open: (id: string) => void }) {
  const save = useSave();
  const nextLevel = CHAPTERS.flatMap((c) => (chapterUnlocked(c, save.passed, save.unlockAll) ? coreOf(c) : [])).find((l) => !save.passed[l.id]);
  const nextChapter = nextLevel ? CHAPTERS.find((c) => c.levels.includes(nextLevel)) : undefined;
  const [selId, setSel] = usePref<string>("map-chapter", "");
  const sel = CHAPTERS.find((c) => c.id === selId) ?? nextChapter ?? CHAPTERS[0];
  const all = CHAPTERS.flatMap((c) => c.levels);
  const corePassed = all.filter((l) => tierOf(l) === "core" && save.passed[l.id]).length;
  const coreTotal = all.filter((l) => tierOf(l) === "core").length;
  const extraPassed = all.filter((l) => tierOf(l) !== "core" && save.passed[l.id]).length;
  const starGot = Object.values(save.stars).reduce((s, a) => s + a.length, 0);
  const starTotal = all.reduce((s, l) => s + starsOf(l), 0);
  return (
    <div className="map">
      <header className="map-hero">
        <div>
          <h1>Bring up the board, one register at a time</h1>
          <p className="map-intro">
            Short briefings with things to try, hands-on puzzles, then real C on a simulated F28379D. Core levels unlock the next chapters; practice levels and expert challenges are optional.
          </p>
          {nextLevel && nextChapter && (
            <button className="btn primary big" onClick={() => open(nextLevel.id)}>
              <Icon name="play" size={16} /> {corePassed ? "Continue" : "Start"}: {nextLevel.title}
              <span className="sub">Chapter {nextChapter.number}, {nextChapter.title}</span>
            </button>
          )}
        </div>
        <dl className="stats" aria-label="Your progress">
          <div><dt>Core levels</dt><dd>{corePassed}<span>/{coreTotal}</span></dd></div>
          <div><dt>Optional levels</dt><dd>{extraPassed}<span>/{all.length - coreTotal}</span></dd></div>
          <div><dt>Stars</dt><dd>{starGot}<span>/{starTotal}</span></dd></div>
        </dl>
      </header>
      <div className="map-cols">
        <div className="map-parts">
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
                <div className="tiles">
                  {chapters.map((c) => {
                    const unlocked = chapterUnlocked(c, save.passed, save.unlockAll);
                    const done = chapterDone(c, save.passed);
                    const core = coreOf(c);
                    const n = core.filter((l) => save.passed[l.id]).length;
                    const extra = c.levels.length - core.length;
                    const extraDone = c.levels.filter((l) => tierOf(l) !== "core" && save.passed[l.id]).length;
                    const state = !unlocked ? "locked" : done ? "done" : c === nextChapter ? "current" : "open";
                    return (
                      <button
                        key={c.id}
                        className={`tile ${state} ${c === sel ? "selected" : ""}`}
                        data-chapter={c.id}
                        aria-pressed={c === sel}
                        aria-label={`Chapter ${c.number}, ${c.title}. ${!unlocked ? "Locked." : done ? "Core path done." : `${n} of ${core.length} core levels passed.`}${c === nextChapter ? " Next up." : ""}`}
                        onClick={() => setSel(c.id)}
                      >
                        <span className="tile-ring">
                          <Ring value={n} max={core.length} />
                          <span className="tile-state">{!unlocked ? <Icon name="lock" size={13} /> : done ? <Icon name="check" size={15} /> : <b>{c.number}</b>}</span>
                        </span>
                        <span className="tile-text">
                          <span className="tile-title">{c.title}</span>
                          <span className="tile-meta">
                            {n}/{core.length} core{extra ? ` · ${extraDone}/${extra} extra` : ""}
                          </span>
                        </span>
                        {c === nextChapter && <span className="tile-flag">Next</span>}
                      </button>
                    );
                  })}
                  {planned.map((p) => (
                    <div key={p.number} className="tile locked planned" aria-label={`Chapter ${p.number}, ${p.title}, coming later`}>
                      <span className="tile-ring">
                        <Ring value={0} max={1} />
                        <span className="tile-state"><b>{p.number}</b></span>
                      </span>
                      <span className="tile-text">
                        <span className="tile-title">{p.title}</span>
                        <span className="tile-meta">Coming later</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <ChapterDetail c={sel} save={save} open={open} nextId={nextLevel?.id} />
      </div>
    </div>
  );
}
