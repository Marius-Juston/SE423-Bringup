import { useMemo, useRef, type KeyboardEvent } from "react";
import { CHAPTERS, PLANNED, chapterDone, chapterUnlocked } from "../levels/index";
import { KIND_LABEL, chapterLabel, kindOf, tierOf, type Chapter, type Level } from "../levels/types";
import { store, useSave, type Save } from "./store";
import { usePref } from "./prefs";
import { Icon, Ring } from "./Icon";
import { pickSession } from "./review";
import { outcomeOf } from "./outcomes";

/** The campaign in parts, by chapter number. */
export const PARTS: { title: string; blurb: string; from: number; to: number }[] = [
  { title: "Start here", blurb: "Never programmed or wired a circuit? Begin with these. Skip them if you already know C and Ohm's law.", from: -3, to: -1 },
  { title: "Foundations", blurb: "Bits, registers, pins, timers, interrupts and the serial port.", from: 0, to: 6 },
  { title: "Analog and motion", blurb: "Voltages in and out, PWM, motors and encoders.", from: 7, to: 11 },
  { title: "Buses and data", blurb: "SPI, I2C, CAN, DMA and digital filters.", from: 12, to: 15 },
  { title: "The robot", blurb: "Control, sensing, localization, vision and planning.", from: 16, to: 20 },
  { title: "Capstone", blurb: "Put the whole robot together with your own code.", from: 21, to: 21 },
];

const starsOf = (l: Level): number => (l.kind === "code" ? (l.bonus?.length ?? 0) : 0);
const coreOf = (c: Chapter) => c.levels.filter((l) => tierOf(l) === "core");
/** The labs and homeworks a chapter supports ("Lab 3", "HW2"), without the lecture numbers. */
const weekTags = (c: Chapter) => c.course.filter((t) => /^(Lab|HW)\s*\d+/i.test(t));
const tagOrder = (t: string) => (/^Lab/i.test(t) ? 0 : 1000) + parseInt(t.replace(/\D+/g, ""), 10);
const WEEKS = [...new Set(CHAPTERS.flatMap(weekTags))].sort((a, b) => tagOrder(a) - tagOrder(b));
const titlesOf = (ids: string[]) => ids.map((r) => CHAPTERS.find((x) => x.id === r)?.title ?? r).join(" and ");

function LevelRow({ l, save, open, current }: { l: Level; save: Save; open: (id: string) => void; current: boolean }) {
  const total = starsOf(l);
  // A star a level no longer has (it was dropped in an update) is not shown.
  const got = Math.min(total, save.stars[l.id]?.length ?? 0);
  const tier = tierOf(l);
  const passed = !!save.passed[l.id];
  const helped = passed && !!save.assisted[l.id];
  return (
    <li>
      <button className={`level-row tier-${tier} ${passed ? (helped ? "assisted" : "passed") : ""} ${current ? "current" : ""}`} data-level={l.id} onClick={() => open(l.id)}>
        <span className="node" aria-hidden="true">
          <Icon name={passed ? "check" : tier === "expert" ? "diamond" : "dot"} size={14} />
        </span>
        <span className="name">
          {l.title}
          <span className="sr-only">{helped ? ", passed with help" : passed ? ", passed" : current ? ", next up" : ""}</span>
          {helped && <span className="with-help" aria-hidden="true">passed with help</span>}
          {total > 0 && (
            <span className="stars" role="img" aria-label={`${got} of ${total} stars`}>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className={i < got ? "" : "empty"}><Icon name="star" size={11} /></span>
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
  const ready = chapterUnlocked(c, save.passed, false);
  const core = coreOf(c);
  const practice = c.levels.filter((l) => tierOf(l) === "practice");
  const expert = c.levels.filter((l) => tierOf(l) === "expert");
  const n = core.filter((l) => save.passed[l.id]).length;
  const first = c.levels.find((l) => !save.passed[l.id] && tierOf(l) === "core") ?? c.levels.find((l) => !save.passed[l.id]);
  const finished = core.length > 0 && n === core.length;
  const optional = [...practice, ...expert];
  const optionalDone = optional.filter((l) => save.passed[l.id]).length;
  const starTotal = c.levels.reduce((t, l) => t + starsOf(l), 0);
  const starGot = c.levels.reduce((t, l) => t + Math.min(starsOf(l), save.stars[l.id]?.length ?? 0), 0);
  const group = (title: string, cls: string, levels: Level[], note: string) =>
    levels.length > 0 && (
      <section className={`tier-group ${cls}`}>
        <h3>
          {title} <span>{levels.filter((l) => save.passed[l.id]).length}/{levels.length}</span>
        </h3>
        <p className="tier-note">{note}</p>
        <ol className="level-list">
          {levels.map((l) => (
            <LevelRow key={l.id} l={l} save={save} open={open} current={l.id === nextId} />
          ))}
        </ol>
      </section>
    );
  return (
    <aside className="chapter-detail" aria-labelledby="chapter-detail-title">
      <p className="eyebrow">Chapter {chapterLabel(c)}</p>
      <h2 id="chapter-detail-title" tabIndex={-1}>{c.title}</h2>
      <p className="chapter-blurb">{c.blurb}</p>
      {c.course.length > 0 && <p className="chapter-course">Course material: {c.course.join(", ")}</p>}
      {!ready && (
        <p className="lock-note">
          <Icon name="bulb" size={15} /> Recommended first: {titlesOf(c.requires)}. This chapter builds on {c.requires.length > 1 ? "them" : "it"}, but every level here is open.
        </p>
      )}
      {finished && (
        <p className="chapter-finished">
          <Icon name="check" size={15} />
          <span>
            <b>Chapter finished.</b> {outcomeOf(c)}
            {optional.length > 0 && optionalDone < optional.length ? ` ${optional.length - optionalDone} optional level${optional.length - optionalDone === 1 ? " is" : "s are"} left for more practice.` : ""}
            {starTotal > 0 ? ` Stars: ${starGot} of ${starTotal}.` : ""}
          </span>
        </p>
      )}
      {first && (
        <button className={`btn ${ready && !finished ? "primary" : ""}`} onClick={() => open(first.id)}>
          <Icon name="play" size={14} /> {finished ? "Optional" : n === 0 ? "Start" : "Continue"}: {first.title}
        </button>
      )}
      {group("Core path", "core", core, "The main line of the chapter.")}
      {group("More practice", "practice", practice, "Optional: the same skills on new cases.")}
      {group("Expert challenges", "expert", expert, "Optional and hard: for going to the bottom of the topic.")}
    </aside>
  );
}

export function MapView({ open, warmup, note }: { open: (id: string) => void; /** Starts a warm-up with these levels. */ warmup?: (ids: string[]) => void; /** The result of the warm-up just finished. */ note?: string }) {
  const save = useSave();
  // Today's warm-up: a few passed puzzles that are due again (none when too few are due, or one was started or dismissed today).
  const session = useMemo(() => (warmup ? pickSession(CHAPTERS, save, Date.now()) : []), [warmup, save.passed, save.passedAt, save.reviews, save.warmupDay]);
  const sessionChapters = [...new Set(session.map((id) => CHAPTERS.find((c) => c.levels.some((l) => l.id === id))?.title ?? ""))].filter(Boolean);
  const fresh = Object.keys(save.passed).length === 0;
  const ordered = [...CHAPTERS].sort((a, b) => a.number - b.number);
  // The primer chapters (before chapter 0) are where a new student starts; one who began at chapter 0 is not sent back to them.
  const primers = ordered.filter((c) => c.number < 0);
  const usesPrimers = fresh || primers.some((c) => c.levels.some((l) => save.passed[l.id]));
  const nextLevel = ordered.flatMap((c) => (chapterUnlocked(c, save.passed, false) && (c.number >= 0 || usesPrimers) ? coreOf(c) : [])).find((l) => !save.passed[l.id]);
  const chapter0 = ordered.find((c) => c.number === 0);
  const nextChapter = nextLevel ? CHAPTERS.find((c) => c.levels.includes(nextLevel)) : undefined;
  const [selId, setSel] = usePref<string>("map-chapter", "");
  const [weekPref, setWeek] = usePref<string>("map-week", "");
  const week = WEEKS.includes(weekPref) ? weekPref : "";
  const sel = CHAPTERS.find((c) => c.id === selId) ?? nextChapter ?? ordered[0];
  const all = CHAPTERS.flatMap((c) => c.levels);
  const corePassed = all.filter((l) => tierOf(l) === "core" && save.passed[l.id]).length;
  const coreTotal = all.filter((l) => tierOf(l) === "core").length;
  const extraPassed = all.filter((l) => tierOf(l) !== "core" && save.passed[l.id]).length;
  // Counted per level that still exists, and never more than the level has now.
  const starGot = all.reduce((s, l) => s + Math.min(starsOf(l), save.stars[l.id]?.length ?? 0), 0);
  const starTotal = all.reduce((s, l) => s + starsOf(l), 0);
  const chaptersDone = CHAPTERS.filter((c) => chapterDone(c, save.passed)).length;
  const parts = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);

  // The chapter tiles are one stop in the Tab order: the arrow keys move between them, Tab goes on to the chapter's levels.
  const onTileKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const tiles = [...(parts.current?.querySelectorAll<HTMLButtonElement>("button[data-chapter]") ?? [])];
    const i = tiles.indexOf(e.currentTarget);
    const j = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tiles.length - 1 : -2;
    if (j === -2) return;
    e.preventDefault();
    const t = tiles[Math.max(0, Math.min(tiles.length - 1, j))];
    t.focus();
    setSel(t.dataset.chapter!);
  };
  // In a narrow window the chapter's levels are below the tiles: choosing a chapter brings them into view.
  const pick = (id: string) => {
    setSel(id);
    requestAnimationFrame(() => {
      const detail = cols.current?.querySelector<HTMLElement>(".chapter-detail");
      if (!detail) return;
      const r = detail.getBoundingClientRect();
      if (r.top > window.innerHeight - 160 || r.bottom < 120) {
        detail.scrollIntoView({ block: "start" });
        detail.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
      }
    });
  };

  return (
    <div className="map">
      <header className="map-hero">
        <div>
          <h1>Bring up the board, one register at a time</h1>
          <p className="map-intro">
            Short briefings with things to try, hands-on puzzles, then real C on a simulated F28379D. Follow the core path in order, or jump to the chapter for this week's lab or homework.
          </p>
          {nextLevel && nextChapter && (
            <button className="btn primary big" onClick={() => open(nextLevel.id)}>
              <Icon name="play" size={16} />
              <span>{fresh ? "Start here" : "Continue"}: {nextLevel.title}</span>
              <span className="sub">Chapter {chapterLabel(nextChapter)}, {nextChapter.title}</span>
            </button>
          )}
          {fresh && primers.length > 0 && chapter0 && nextChapter && nextChapter.number < 0 && (
            <p className="skip-primer">
              Already know C and basic circuits?{" "}
              <button className="linkish" onClick={() => open(coreOf(chapter0)[0].id)}>Start at chapter {chapterLabel(chapter0)}, {chapter0.title}</button>.
            </p>
          )}
          {fresh && (
            <ol className="howto" aria-label="How a level works">
              <li><b>Read</b> the short briefing and play with its figures.</li>
              <li><b>Try</b> the puzzle or write the code.</li>
              <li><b>Check</b> it: on code levels, Run tests says what the board did.</li>
              <li><b>Stuck?</b> Every level has hints, from a nudge to nearly the answer.</li>
            </ol>
          )}
        </div>
        <dl className="stats" aria-label="Your progress">
          <div><dt>Core levels</dt><dd>{corePassed}<span>/{coreTotal}</span></dd></div>
          <div><dt>Optional levels</dt><dd>{extraPassed}<span>/{all.length - coreTotal}</span></dd></div>
          <div><dt>Stars</dt><dd>{starGot}<span>/{starTotal}</span></dd></div>
          <div><dt>Chapters finished</dt><dd>{chaptersDone}<span>/{CHAPTERS.length}</span></dd></div>
        </dl>
      </header>
      {note && (
        <p className="warm-note" role="status">
          <Icon name="check" size={15} /> {note}
        </p>
      )}
      {session.length > 0 && warmup && (
        <section className="warmup" aria-labelledby="warmup-title">
          <span className="warmup-mark" aria-hidden="true"><Icon name="reset" size={18} /></span>
          <div className="warmup-text">
            <h2 id="warmup-title">Warm-up: {session.length} quick questions from earlier chapters</h2>
            <p>
              {sessionChapters.join(", ")}. Answering again after a few days is what makes it stick.
            </p>
          </div>
          <div className="warmup-actions">
            <button className="btn" onClick={() => warmup(session)}>
              <Icon name="play" size={13} /> Start the warm-up
            </button>
            <button className="btn ghost" onClick={() => store.warmupSeen()} title="Hides the warm-up until tomorrow">
              Not today
            </button>
          </div>
        </section>
      )}
      {WEEKS.length > 0 && (
        <div className="weeks" role="group" aria-label="Show the chapters for a lab or homework (arrow keys move along the row)">
          <span className="eyebrow" aria-hidden="true">Working on</span>
          {["", ...WEEKS].map((w) => (
            <button
              key={w}
              className="week"
              aria-pressed={week === w}
              tabIndex={week === w ? 0 : -1}
              onClick={() => setWeek(w)}
              onKeyDown={(e) => {
                // One stop in the Tab order: the arrow keys move along the row.
                const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.key === "ArrowLeft" || e.key === "ArrowUp" ? e.currentTarget.previousElementSibling : null;
                if (next instanceof HTMLButtonElement) {
                  e.preventDefault();
                  next.focus();
                }
              }}
            >
              {w || "All"}
            </button>
          ))}
          {week && (
            <span className="hint-text" role="status">
              {CHAPTERS.filter((c) => weekTags(c).includes(week)).length} chapters support {week}; the others are dimmed.
            </span>
          )}
        </div>
      )}
      <div className="map-cols" ref={cols}>
        <div className="map-parts" ref={parts}>
          <p className="sr-only" id="tiles-help">Use the arrow keys to move between chapters. Tab moves on to the levels of the chosen chapter.</p>
          {PARTS.map((part) => {
            const chapters = CHAPTERS.filter((c) => c.number >= part.from && c.number <= part.to);
            const planned = PLANNED.filter((p) => p.number >= part.from && p.number <= part.to);
            if (!chapters.length && !planned.length) return null;
            const single = chapters.length + planned.length === 1;
            const partDone = chapters.length > 0 && planned.length === 0 && chapters.every((c) => chapterDone(c, save.passed));
            return (
              <section key={part.title} className="part" aria-labelledby={`part-${part.from}`}>
                <div className="part-head">
                  <h2 id={`part-${part.from}`}>
                    {part.title}
                    {partDone && (
                      <span className="part-done">
                        <Icon name="check" size={12} /> Finished
                      </span>
                    )}
                  </h2>
                  <p>{part.blurb}</p>
                </div>
                <div className={`tiles ${single ? "single" : ""}`}>
                  {chapters.map((c) => {
                    const ready = chapterUnlocked(c, save.passed, false);
                    const done = chapterDone(c, save.passed);
                    const core = coreOf(c);
                    const n = core.filter((l) => save.passed[l.id]).length;
                    const extra = c.levels.length - core.length;
                    const extraDone = c.levels.filter((l) => tierOf(l) !== "core" && save.passed[l.id]).length;
                    const state = done ? "done" : c === nextChapter ? "current" : ready ? "open" : "later";
                    const tags = weekTags(c);
                    const match = !!week && tags.includes(week);
                    return (
                      <button
                        key={c.id}
                        className={`tile ${state} ${c === sel ? "selected" : ""} ${week ? (match ? "match" : "dim") : ""}`}
                        data-chapter={c.id}
                        aria-pressed={c === sel}
                        aria-describedby="tiles-help"
                        tabIndex={c === sel ? 0 : -1}
                        onKeyDown={onTileKey}
                        onClick={() => pick(c.id)}
                      >
                        <span className="tile-ring" aria-hidden="true">
                          <Ring value={n} max={core.length} />
                          <span className="tile-state">{done ? <Icon name="check" size={15} /> : <b>{chapterLabel(c)}</b>}</span>
                        </span>
                        <span className="tile-text">
                          <span className="tile-title">
                            <span className="sr-only">Chapter {chapterLabel(c)}: </span>
                            {c.title}
                          </span>
                          {single && <span className="tile-blurb">{c.blurb}</span>}
                          <span className="tile-meta">
                            {done ? <b className="tile-done">Finished</b> : `${n}/${core.length} core`}{extra ? ` · ${extraDone}/${extra} extra` : ""}
                            <span className="sr-only">{done ? ". Core path done." : ""}{c === nextChapter ? ". Next up." : ""}{match ? `. Supports ${week}.` : ""}</span>
                          </span>
                          {!ready && !done && <span className="tile-advice">First: {titlesOf(c.requires)}</span>}
                          {tags.length > 0 && (
                            <span className="tile-tags">
                              <span className="sr-only">For </span>
                              {tags.map((t) => (
                                <span key={t} className={`tag ${t === week ? "on" : ""}`}>{t}</span>
                              ))}
                            </span>
                          )}
                        </span>
                        {c === nextChapter && <span className="tile-flag" aria-hidden="true">{fresh ? "Start" : "Next"}</span>}
                      </button>
                    );
                  })}
                  {planned.map((p) => (
                    <div key={p.number} className="tile planned">
                      <span className="tile-ring" aria-hidden="true">
                        <Ring value={0} max={1} />
                        <span className="tile-state"><b>{p.number}</b></span>
                      </span>
                      <span className="tile-text">
                        <span className="tile-title"><span className="sr-only">Chapter {p.number}: </span>{p.title}</span>
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
