import { useState } from "react";

// The lost update of chapter 20 (lecture 13; levels thr-lost-update and
// thr-race): `counter += 1` can compile to three machine steps, read, add, write, and
// another thread or an interrupt can run between them. On the F28379D the
// critical section is DINT ... EINT: DINT sets the CPU's interrupt mask
// INTM, a request that arrives meanwhile keeps its flag and is served
// after EINT (TRM sections 3.4.3 and 3.4.4, the references of level
// thr-race). The numbers are the level's: counter starts at 5.

type Mode = "threads" | "irq";
type Op = "lock" | "read" | "add" | "write" | "unlock";

const START = 5;
const BODY: Op[] = ["read", "add", "write"];

interface Model {
  mode: Mode;
  guard: boolean;
  counter: number;
  pc: [number, number];
  reg: [number | null, number | null];
  /** Who holds the mutex (threads) or 0 while INTM is set (interrupt mode); -1 = free. */
  holder: -1 | 0 | 1;
  /** Interrupt mode: a request is waiting for EINT. */
  pending: boolean;
  log: string[];
  last: { who: 0 | 1; op: Op } | null;
  msg: string;
}

const names = (mode: Mode): [string, string] => (mode === "threads" ? ["A", "B"] : ["main()", "the interrupt"]);

const opsOf = (m: Pick<Model, "mode" | "guard">, who: 0 | 1): Op[] => (m.guard && (m.mode === "threads" || who === 0) ? ["lock", ...BODY, "unlock"] : BODY);

const fresh = (mode: Mode, guard: boolean): Model => ({
  mode,
  guard,
  counter: START,
  pc: [0, 0],
  reg: [null, null],
  holder: -1,
  pending: false,
  log: [],
  last: null,
  msg:
    mode === "threads"
      ? guard
        ? "Try the same unlucky order: step A twice (lock, read), then try to step B."
        : `counter holds ${START}. Each thread adds 1, so it should end at ${START + 2}. Find the unlucky order: step A once (its read), run B completely, then finish A.`
      : guard
        ? "Step main() twice (DINT, read), then fire the interrupt."
        : `counter holds ${START}. main() and the interrupt each add 1, so it should end at ${START + 2}. Step main() once (its read), then fire the interrupt, then finish main().`,
});

const done = (m: Model, who: 0 | 1) => m.pc[who] >= opsOf(m, who).length;

/** Runs one step of `who`; returns the new model. */
function step(m: Model, who: 0 | 1): Model {
  const ops = opsOf(m, who);
  if (m.pc[who] >= ops.length) return m;
  const op = ops[m.pc[who]];
  const [na, nb] = names(m.mode);
  const me = who === 0 ? na : nb;
  const other = who === 0 ? nb : na;
  const n: Model = { ...m, pc: [...m.pc] as [number, number], reg: [...m.reg] as [number | null, number | null], log: [...m.log], last: { who, op } };
  const short = m.mode === "threads" ? me : who === 0 ? "main" : "ISR";
  switch (op) {
    case "lock":
      if (m.mode === "threads") {
        if (m.holder !== -1 && m.holder !== who) {
          n.last = m.last;
          n.msg = `${me} wants the lock, but ${other} holds it, so ${me} has to wait. Nothing of ${me} can run between ${other}'s read and write any more: finish ${other} first.`;
          if (n.log[n.log.length - 1] !== `${short} waits`) n.log.push(`${short} waits`);
          return n;
        }
        n.holder = who;
        n.msg = `${me} locks the mutex. Until ${me} unlocks it, ${other} cannot enter its own critical section.`;
        n.log.push(`${short} lock`);
      } else {
        n.holder = 0;
        n.msg = "DINT sets the interrupt mask INTM: no interrupt function can start until EINT.";
        n.log.push("main DINT");
      }
      break;
    case "read":
      n.reg[who] = m.counter;
      n.msg = `${me} reads counter: its own register now holds ${m.counter}. The register is a private copy. If counter changes now, the copy does not.`;
      n.log.push(`${short} read ${m.counter}`);
      break;
    case "add":
      n.reg[who] = (m.reg[who] ?? 0) + 1;
      n.msg = `${me} adds 1 in its register: ${n.reg[who]}. counter in memory is still ${m.counter}.`;
      n.log.push(`${short} add: ${n.reg[who]}`);
      break;
    case "write": {
      const v = m.reg[who] ?? 0;
      n.counter = v;
      const stale = v <= m.counter;
      n.msg = stale
        ? `${me} writes its register: counter is ${v}. It was already ${m.counter}: ${me} worked on a copy from before ${other}'s update, so that update is overwritten.`
        : `${me} writes its register back: counter is ${v}.`;
      n.log.push(`${short} write ${v}`);
      break;
    }
    case "unlock":
      n.holder = -1;
      if (m.mode === "threads") {
        n.msg = `${me} unlocks the mutex. ${other} may take it now.`;
        n.log.push(`${short} unlock`);
      } else {
        n.msg = "EINT clears INTM: interrupts are on again.";
        n.log.push("main EINT");
      }
      break;
  }
  n.pc[who]++;
  if (op === "unlock" && m.mode === "irq" && m.pending) {
    // The request that waited is served right after EINT.
    let r: Model = { ...n, pending: false };
    for (let k = 0; k < BODY.length; k++) r = step(r, 1);
    r.msg = `EINT clears INTM, and the interrupt that was waiting runs at once: it reads ${n.counter}, adds 1 and writes ${r.counter}. It was delayed, not lost.`;
    return r;
  }
  return n;
}

function fire(m: Model): Model {
  if (m.pending || done(m, 1)) return m;
  if (m.holder === 0) return { ...m, pending: true, log: [...m.log, "request waits"], msg: "The interrupt request arrives while INTM is set. Its flag stays set and the function does not start: main()'s read, add and write stay together. Keep stepping main() to EINT." };
  let r = m;
  for (let k = 0; k < BODY.length; k++) r = step(r, 1);
  const between = m.pc[0] > 0 && !done(m, 0);
  return {
    ...r,
    msg: between
      ? `The interrupt runs all three of its steps between two steps of main(): counter is ${r.counter}. main() still has the old ${m.reg[0]} in its register.`
      : `The interrupt runs its three steps while main() is not in the middle of its own: counter is ${r.counter}. Nothing was lost this time, because the interrupt did not come between main()'s read and write.`,
  };
}

const TEXT: Record<Op, string> = { lock: "", read: "read    reg = counter", add: "add     reg = reg + 1", write: "write   counter = reg", unlock: "" };

function LostUpdate() {
  const [m, setM] = useState<Model>(() => fresh("threads", false));
  const [na, nb] = names(m.mode);
  const allDone = done(m, 0) && done(m, 1);
  const lost = allDone && m.counter !== START + 2;
  const label = (op: Op) => (op === "lock" ? (m.mode === "threads" ? "lock    the mutex" : "DINT;   interrupts off") : op === "unlock" ? (m.mode === "threads" ? "unlock  the mutex" : "EINT;   interrupts on") : TEXT[op]);
  const guardName = m.mode === "threads" ? "mutex" : "DINT / EINT";
  const code = !m.guard
    ? "counter += 1;"
    : m.mode === "threads"
      ? "pthread_mutex_lock(&m);\ncounter += 1;\npthread_mutex_unlock(&m);"
      : "DINT;\ncounter += 1;\nEINT;";
  const lockText =
    m.mode === "threads"
      ? !m.guard
        ? ["no lock", "any order is possible"]
        : m.holder === -1
          ? ["mutex: free", "first to lock gets it"]
          : [`mutex: held by ${m.holder === 0 ? "A" : "B"}`, `${m.holder === 0 ? "B" : "A"} must wait`]
      : !m.guard
        ? ["interrupts on", "may fire at any step"]
        : m.holder === 0
          ? ["INTM = 1: interrupts off", m.pending ? "one request is waiting" : "requests have to wait"]
          : ["INTM = 0: interrupts on", "may fire now"];
  const colX = [6, 278];
  const W = 136;
  const column = (who: 0 | 1) => {
    const ops = opsOf(m, who);
    const x = colX[who];
    return (
      <g key={who}>
        <text x={x + W / 2} y="13" textAnchor="middle" className="fig-label dim">{m.mode === "threads" ? `THREAD ${who === 0 ? "A" : "B"}` : who === 0 ? "main()" : "TIMER INTERRUPT"}</text>
        {ops.map((op, k) => {
          const isLast = m.last?.who === who && m.last.op === op && m.pc[who] === k + 1;
          const isNext = m.pc[who] === k;
          const isDone = m.pc[who] > k;
          return (
            <g key={op}>
              <rect x={x} y={20 + k * 22} width={W} height="19" rx="4" className={`fig-box ${isLast ? "hot" : isNext ? "active" : isDone ? "off" : ""}`} />
              <text x={x + 5} y={33 + k * 22} className="fig-label">{isDone ? "✓" : isNext ? "▶" : ""}</text>
              <text x={x + 17} y={33 + k * 22} className={`fig-label lu-mono ${isDone && !isLast ? "dim" : ""}`}>{label(op)}</text>
            </g>
          );
        })}
        <rect x={x} y="142" width={W} height="36" rx="4" className={`fig-box ${m.last?.who === who && m.last.op !== "lock" && m.last.op !== "unlock" ? "hot" : ""}`} />
        <text x={x + W / 2} y="155" textAnchor="middle" className="fig-label">{m.mode === "threads" ? `register of ${who === 0 ? "A" : "B"}` : who === 0 ? "register of main()" : "register of the interrupt"}</text>
        <text x={x + W / 2} y="171" textAnchor="middle" className="fig-value">{m.reg[who] ?? "-"}</text>
      </g>
    );
  };
  const arrow = () => {
    if (!m.last || (m.last.op !== "read" && m.last.op !== "write")) return null;
    const left = m.last.who === 0;
    const from = m.last.op === "read" ? (left ? 164 : 256) : left ? 142 : 278;
    const to = m.last.op === "read" ? (left ? 144 : 276) : left ? 162 : 258;
    return <path d={`M${from} 160 H${to}`} className="fig-wire hot" markerEnd="url(#lu-arrow)" />;
  };
  return (
    <figure className="figure lu-fig" aria-label="Interactive lost update: two pieces of code each add 1 to a shared counter">
      <style>{`
        .lu-fig .lu-mono { font-family: var(--mono); font-size: 8.5px; white-space: pre; }
        .lu-fig .lu-hot { fill: var(--orange); }
        .lu-fig .lu-big { font-size: 20px; }
        .lu-fig .lu-log { display: flex; flex-wrap: wrap; gap: 0.25rem; list-style: none; margin: 0.4rem 0 0; padding: 0; font-family: var(--mono); font-size: 0.75rem; min-height: 1.6rem; }
        .lu-fig .lu-log li { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 0.05em 0.45em; }
        .lu-fig .lu-log li.wait { border-style: dashed; color: var(--dim); }
        .lu-fig .lu-verdict { font-weight: 700; }
        .lu-fig .fig-controls pre { margin: 0; font-size: 0.75rem; }
        .lu-fig .fig-controls pre code { margin-left: 0; }
      `}</style>
      <div className="fig-controls">
        <div>
          <span>Who</span>
          <button className="fig-opt" aria-pressed={m.mode === "threads"} onClick={() => setM(fresh("threads", m.guard))}>two threads</button>
          <button className="fig-opt" aria-pressed={m.mode === "irq"} onClick={() => setM(fresh("irq", m.guard))}>main and an interrupt</button>
        </div>
        <div>
          <span>Protection</span>
          <button className="fig-opt" aria-pressed={!m.guard} onClick={() => setM(fresh(m.mode, false))}>none</button>
          <button className="fig-opt" aria-pressed={m.guard} onClick={() => setM(fresh(m.mode, true))}>{guardName}</button>
          <pre><code>{code}</code></pre>
        </div>
      </div>
      <svg viewBox="0 0 420 186" role="img" aria-label={`counter is ${m.counter}. ${na} has done ${m.pc[0]} of ${opsOf(m, 0).length} steps and its register holds ${m.reg[0] ?? "nothing"}. ${nb} has done ${m.pc[1]} of ${opsOf(m, 1).length} steps and its register holds ${m.reg[1] ?? "nothing"}. ${lockText[0]}.`}>
        <defs>
          <marker id="lu-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="lu-hot" />
          </marker>
        </defs>
        {column(0)}
        {column(1)}
        <text x="210" y="13" textAnchor="middle" className="fig-label dim">SHARED</text>
        <rect x="152" y="20" width="116" height="34" rx="4" className={`fig-box ${m.guard && m.holder !== -1 ? "hot" : m.guard ? "" : "off"}`} strokeDasharray={m.guard ? undefined : "4 3"} />
        <text x="210" y="34" textAnchor="middle" className="fig-label">{lockText[0]}</text>
        <text x="210" y="46" textAnchor="middle" className="fig-label dim">{lockText[1]}</text>
        <rect x="164" y="118" width="92" height="60" rx="4" className={`fig-box ${m.last?.op === "write" ? "hot" : "active"}`} />
        <text x="210" y="132" textAnchor="middle" className="fig-label">counter</text>
        <text x="210" y="157" textAnchor="middle" className="fig-value lu-big">{m.counter}</text>
        <text x="210" y="172" textAnchor="middle" className="fig-label dim">in memory</text>
        <text x="210" y="80" textAnchor="middle" className="fig-label dim">should end at {START + 2}</text>
        {allDone && <text x="210" y="96" textAnchor="middle" className="fig-label lu-verdict">{lost ? `✗ ended at ${m.counter}` : `✓ ended at ${m.counter}`}</text>}
        {arrow()}
      </svg>
      <div className="fig-controls row">
        <button className="btn small primary" onClick={() => setM(step(m, 0))} disabled={done(m, 0)}>{m.mode === "threads" ? "Step thread A" : "Step main()"}</button>
        {m.mode === "threads" ? (
          <button className="btn small primary" onClick={() => setM(step(m, 1))} disabled={done(m, 1)}>Step thread B</button>
        ) : (
          <button className="btn small primary" onClick={() => setM(fire(m))} disabled={done(m, 1) || m.pending}>Fire the interrupt</button>
        )}
        <button className="btn small" onClick={() => setM(fresh(m.mode, m.guard))}>Reset</button>
      </div>
      <div className="fig-step" role="status">
        <p>
          {allDone ? (
            lost ? (
              <>
                <strong>Lost update: counter is {m.counter}, not {START + 2}.</strong> Both sides read {START}, so both wrote {START + 1}. Nothing crashed and nothing was reported. Reset and turn on {m.mode === "threads" ? "the mutex" : "DINT / EINT"} to see what prevents it.
              </>
            ) : m.guard ? (
              <>
                <strong>counter is {m.counter}, in every order you can try.</strong> {m.mode === "threads" ? "With the mutex, the three steps of one thread always run as a block: the other thread waits at its lock." : "With interrupts off between DINT and EINT, nothing can run between main()'s read and write. The request waited and ran afterwards."}
              </>
            ) : (
              <>
                <strong>counter is {m.counter}: correct, this time.</strong> The order you chose never put one side's steps between the other's read and write. Reset and try: {m.mode === "threads" ? "A once, B three times, A twice." : "main() once, fire the interrupt, main() twice."}
              </>
            )
          ) : (
            m.msg
          )}
        </p>
        <ol className="lu-log" aria-label="Steps so far, in order">
          {m.log.map((l, k) => (
            <li key={k} className={l.includes("wait") ? "wait" : ""}>{l}</li>
          ))}
        </ol>
      </div>
      <figcaption>
        <code>counter += 1;</code> can become three machine steps: read, add, write. You choose who runs next. {m.mode === "irq" ? "main() cannot pause an interrupt function, so the interrupt always runs its three steps together, but it can start between any two steps of main()." : "Two threads on the Raspberry Pi can be paused between any two steps."}
      </figcaption>
    </figure>
  );
}

export const figure = { id: "lost-update", Component: LostUpdate };
