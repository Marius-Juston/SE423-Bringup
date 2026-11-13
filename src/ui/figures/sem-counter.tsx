import { useState } from "react";

// A flag against a counting semaphore, lecture 13. The interrupt asks main for
// jobs; main takes them one at a time. A flag (the starter code's UARTPrint)
// can only say "at least one", a semaphore counts. The code lines are the
// flag pattern of chapter 5 and the reference solution of the level
// "A semaphore made of a counter" in chapter 20 (DINT / EINT: TRM 3.4.3).

interface S {
  sem: boolean;
  /** Value of the flag (0 or 1) or of the semaphore. */
  value: number;
  posted: number;
  done: number;
  last: "" | "post" | "post-lost" | "take" | "none";
}

const fresh = (sem: boolean): S => ({ sem, value: 0, posted: 0, done: 0, last: "" });

function post(s: S): S {
  if (s.sem) return { ...s, value: s.value + 1, posted: s.posted + 1, last: "post" };
  return { ...s, value: 1, posted: s.posted + 1, last: s.value === 1 ? "post-lost" : "post" };
}

function take(s: S): S {
  if (s.value === 0) return { ...s, last: "none" };
  return { ...s, value: s.sem ? s.value - 1 : 0, done: s.done + 1, last: "take" };
}

function SemCounter() {
  const [s, setS] = useState<S>(fresh(false));
  const lost = s.posted - s.done - s.value;
  const name = s.sem ? "sem" : "flag";
  const why =
    s.last === ""
      ? `Press "Interrupt: one more job" three times before main takes one, first with the flag, then with the semaphore.`
      : s.last === "post-lost"
        ? `The flag was already 1, and writing 1 again changes nothing. That request left no trace: ${lost} job${lost === 1 ? "" : "s"} forgotten so far.`
        : s.last === "post"
          ? s.sem
            ? `sem went up to ${s.value}: ${s.value} job${s.value === 1 ? " is" : "s are"} waiting, and every request is remembered.`
            : "The flag is 1: main knows there is work, but not how much."
          : s.last === "take"
            ? s.sem
              ? `main took one job and sem went down to ${s.value}. ${s.value ? "It will find the next one on its next pass." : "Nothing is waiting."}`
              : `main set the flag back to 0 and did one job.${lost ? ` It cannot know that ${lost} more ${lost === 1 ? "was" : "were"} asked for.` : ""}`
            : `${name} is 0: nothing to take. main goes on with its loop and tries again on the next pass.`;
  const tokens = Math.min(s.value, 8);

  return (
    <figure className="figure" aria-label="A flag compared with a counting semaphore">
      <svg viewBox="0 0 300 132" role="img" aria-label={`${s.sem ? "Semaphore" : "Flag"} holds ${s.value}. The interrupt asked for ${s.posted} jobs, main did ${s.done}, ${s.value && s.sem ? `${s.value} waiting, ` : ""}${lost} forgotten.`}>
        {/* interrupt */}
        <rect x="3" y="22" width="82" height="58" rx="6" className={`fig-box ${s.last.startsWith("post") ? "hot" : "active"}`} />
        <text x="44" y="37" textAnchor="middle" className="fig-label">timer interrupt</text>
        <text x="44" y="50" textAnchor="middle" className="fig-label dim">jobs asked for</text>
        <text x="44" y="69" textAnchor="middle" className="fig-value">{s.posted}</text>
        <line x1="85" y1="51" x2="101" y2="51" className="fig-wire" />
        <polygon points="101,47 108,51 101,55" className="fig-arrowhead" />
        <text x="96" y="43" textAnchor="middle" className="fig-label dim">{s.sem ? "+1" : "= 1"}</text>
        {/* the shared variable */}
        <rect x="108" y="6" width="84" height="88" rx="6" className="fig-box active" />
        <text x="150" y="20" textAnchor="middle" className="fig-label">{s.sem ? "sem (a counter)" : "flag (0 or 1)"}</text>
        <text x="150" y="40" textAnchor="middle" className="fig-value">{s.value}</text>
        {Array.from({ length: 8 }, (_, i) => (
          <circle key={i} cx={120 + (i % 4) * 20} cy={56 + Math.floor(i / 4) * 20} r="7" style={{ fill: i < tokens ? "var(--orange)" : "none", stroke: "var(--dim)", strokeDasharray: i < tokens ? undefined : "2 2", opacity: s.sem || i === 0 ? 1 : 0.25 }} />
        ))}
        <line x1="192" y1="51" x2="208" y2="51" className="fig-wire" />
        <polygon points="208,47 215,51 208,55" className="fig-arrowhead" />
        <text x="203" y="43" textAnchor="middle" className="fig-label dim">{s.sem ? "-1" : "= 0"}</text>
        {/* main */}
        <rect x="215" y="22" width="82" height="58" rx="6" className={`fig-box ${s.last === "take" ? "hot" : "active"}`} />
        <text x="256" y="37" textAnchor="middle" className="fig-label">main()</text>
        <text x="256" y="50" textAnchor="middle" className="fig-label dim">jobs done</text>
        <text x="256" y="69" textAnchor="middle" className="fig-value">{s.done}</text>
        {/* balance */}
        <text x="150" y="112" textAnchor="middle" className="fig-label">
          asked {s.posted} = done {s.done} + waiting {s.value} + forgotten{" "}
          <tspan className="fig-value" style={{ fill: lost ? "var(--bad)" : undefined }}>{lost}</tspan>
        </text>
        <text x="150" y="126" textAnchor="middle" className="fig-label dim">{s.sem ? "a semaphore never forgets a request" : "a flag forgets requests made while it is already 1"}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Kind</span>
          <button className="fig-opt" aria-pressed={!s.sem} onClick={() => setS(fresh(false))}>flag</button>
          <button className="fig-opt" aria-pressed={s.sem} onClick={() => setS(fresh(true))}>semaphore</button>
        </div>
        <div>
          <span>Interrupt</span>
          <button className="btn small primary" onClick={() => setS(post(s))} disabled={s.sem && s.value >= 8}>Interrupt: one more job</button>
          <code>{s.sem ? "sem++;" : "flag = 1;"}</code>
        </div>
        <div>
          <span>main</span>
          <button className="btn small" onClick={() => setS(take(s))}>main: take a job</button>
          <code>{s.sem ? "DINT; if (sem > 0) { sem--; got = 1; } EINT;" : "if (flag == 1) { flag = 0; do_job(); }"}</code>
        </div>
        <div>
          <span />
          <button className="btn small" onClick={() => setS(fresh(s.sem))} disabled={s.posted === 0 && s.last === ""}>Reset</button>
        </div>
      </div>
      <figcaption>The interrupt asks, main does the work. A flag only remembers that something was asked. A semaphore remembers how many times.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "sem-counter",
  title: "Flag or counting semaphore",
  description: "Let the interrupt ask for work several times before main gets to it and compare how many requests a flag and a semaphore remember.",
  Component: SemCounter,
};
