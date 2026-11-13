import { useState } from "react";
import { Brace, Cells, MEM_CSS, type Cell } from "./mem-shared";

// Text in C: an array of char, one character per box, closed by a box that
// holds the number 0. On the F28379D a char is 16 bits, so it takes a whole
// box like an int (TMS320C28x compiler guide, data types). The character
// numbers are the ASCII codes (taught in chapter 6): r 114, o 111, b 98,
// t 116, ! 33, H 72.

const TEXT: [string, number][] = [["r", 114], ["o", 111], ["b", 98], ["o", 111], ["t", 116]];

function MemString() {
  const [n, setN] = useState(0);
  const [closed, setClosed] = useState(true);
  // What sits in each of the 8 boxes: the string, its closing 0 (or '!'), then another variable.
  const boxes: [string, number][] = [...TEXT, closed ? ["", 0] : ["!", 33], ["H", 72], ["", 0]];
  const end = boxes.findIndex((b) => b[1] === 0);
  const at = Math.min(n, end);
  const done = at === end;
  const cells: Cell[] = boxes.map(([ch, num], k): Cell => ({
    addr: 0x0100 + k,
    name: k < 6 ? `word[${k}]` : k === 6 ? "other" : undefined,
    value: num === 0 ? "0" : `'${ch}' ${num}`,
    small: num !== 0,
    state: k === at ? (k > 5 ? "bad" : "hot") : undefined,
  }));
  const printed = boxes.slice(0, end).map((b) => b[0]).join("");
  const why = done
    ? closed
      ? `word[${end}] holds 0, so the text ends here. The loop counted ${end} characters, and printf would print "${printed}". The 0 is not printed and not counted, but it needs its own box: 5 letters take 6 boxes.`
      : `The closing 0 is gone, so nothing stops at word[5]. The loop walks out of the array into the next variable and only stops at the first 0 it happens to find: ${end} "characters", and printf would print "${printed}".`
    : at > 5
      ? `The loop is now past the end of the array, in the box of the variable other. It holds ${boxes[at][1]} ('${boxes[at][0]}'), not 0, so the loop takes it for one more character and goes on.`
      : `word[${at}] holds ${boxes[at][1]}, the number that stands for the character '${boxes[at][0]}'. It is not 0, so the text goes on: count it and look at the next box.`;
  return (
    <figure className="figure" aria-label="Interactive diagram: a string is an array of characters that ends with 0">
      <style>{MEM_CSS}</style>
      <svg viewBox="0 0 400 100" role="img" aria-label={`The array word holds the characters ${boxes.slice(0, 6).map((b) => (b[1] === 0 ? "zero" : b[0])).join(", ")}. The loop is at box ${at}${done ? " and has stopped at a zero" : ""}. Characters counted: ${at}.`}>
        <text x="8" y="9" className="fig-label dim">char word[6] = "robot";   char other = 'H';</text>
        <Cells cells={cells} />
        <Brace slot={0} count={6} label="the array word: 5 letters and the closing 0" />
      </svg>
      <code className="mem-out">while (word[n] != 0) n = n + 1;      n = {at}{done ? "   (stopped)" : ""}</code>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Loop</span>
          <button className="fig-opt" onClick={() => setN(at + 1)} disabled={done}>Look at the next box</button>
          <button className="fig-opt" onClick={() => setN(0)} disabled={at === 0}>Start again</button>
        </div>
        <div>
          <span>word[5]</span>
          <button className="fig-opt" aria-pressed={closed} onClick={() => { setClosed(true); setN(0); }}>0, as it should be</button>
          <button className="fig-opt" aria-pressed={!closed} onClick={() => { setClosed(false); setN(0); }}>overwritten</button>
          <code>{closed ? "word[5] = 0;" : "word[5] = '!';"}</code>
        </div>
      </div>
      <figcaption>Each box holds a number; shown next to it is the character that number stands for. Text ends at the first box that holds 0. Red means the loop has left the array.</figcaption>
    </figure>
  );
}

export const figure = { id: "mem-string", Component: MemString };
