// One ADC conversion from trigger to interrupt. TRM chapter 11: SOC
// configuration 11.5 (ADCSOCxCTL: TRIGSEL Table 11-32, 0Bh = ePWM4 ADCSOCA;
// CHSEL; ACQPS, window = ACQPS + 1 SYSCLK cycles), result formula 11.4.5,
// interrupts 11.9 (ADCINTSEL1N2.INT1SEL / INT1E). The ePWM pulse: TRM 15.10,
// ETSEL.SOCASEL = 2 (counter equals period), ETPS.SOCAPRD = 1 (first event),
// ETSEL.SOCAEN. Same numbers as the level's code (ch08) and
// src/sim/plugins/adc.ts + epwm.ts.
import { useState } from "react";

const CSS = `
.adcch pre { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

const STEPS: { title: string; text: string; code: string; hot: string[] }[] = [
  {
    title: "Idle",
    text: "Nothing happens until a trigger arrives. SOC0 is a configuration slot, not a converter: it holds three answers. When? (TRIGSEL) Which pin? (CHSEL) How long to sample? (ACQPS) Press Next to fire the trigger.",
    code: "// when: ePWM4 SOCA\nAdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 11;\n// which pin: ADCINA4\nAdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;\n// how long: 100 SYSCLK cycles\nAdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;",
    hot: [],
  },
  {
    title: "1. The trigger fires",
    text: "ePWM4's counter reaches the point chosen in ETSEL and it sends one pulse on its SOCA line. The ePWM is used here only as a precise clock: the pulse says when, nothing more. A CPU timer or a software write can pulse the same way.",
    code: "// pulse when the counter equals the period\nEPwm4Regs.ETSEL.bit.SOCASEL = 2;\n// on every such event\nEPwm4Regs.ETPS.bit.SOCAPRD = 1;\n// enable the SOCA pulse\nEPwm4Regs.ETSEL.bit.SOCAEN = 1;",
    hot: ["trig", "w-trig"],
  },
  {
    title: "2. SOC0 wakes up",
    text: "Every SOC listens to exactly one trigger. SOC0's TRIGSEL is 11, which means ePWM4 SOCA, so this pulse marks SOC0 as pending. SOCs with another TRIGSEL ignore it.",
    code: "AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 11;",
    hot: ["soc"],
  },
  {
    title: "3. The channel is selected",
    text: "SOC0's CHSEL is 4, so the input switch connects pin ADCINA4 to the converter. The channel is which pin gets measured. It has nothing to do with the SOC number or the trigger.",
    code: "AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;",
    hot: ["soc", "pins", "w-pin"],
  },
  {
    title: "4. Sample",
    text: "For ACQPS + 1 system clock cycles a small capacitor charges to the pin's voltage, then the switch opens and the capacitor holds that voltage still. With ACQPS = 99 that is 100 x 5 ns = 500 ns.",
    code: "AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;",
    hot: ["sh", "w-pin"],
  },
  {
    title: "5. Convert",
    text: "The converter turns the held voltage into a 12-bit number by successive approximation: 12 yes/no comparisons, from the top bit down. There is one converter per ADC module, shared by all 16 SOCs, so pending SOCs take turns.",
    code: "// result = 4096 x Vin / 3.0 V, limited to 0..4095",
    hot: ["sar", "w-sar"],
  },
  {
    title: "6. The result is stored",
    text: "SOC0's result goes to ADCRESULT0. The result register always has the SOC's number: SOC3 fills ADCRESULT3, whatever channel it measured.",
    code: "adcValue = AdcaResultRegs.ADCRESULT0;\nvolts = adcValue * 3.0 / 4096.0;",
    hot: ["res", "w-res"],
  },
  {
    title: "7. The interrupt",
    text: "INT1SEL names the SOC whose end of conversion raises ADCINT1. Point it at the last SOC of your sequence. ADCINT1 goes through the PIE (group 1, channel 1) to your interrupt function, which must clear the flag and acknowledge the group.",
    code: "// the end of SOC0 sets ADCINT1\nAdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0;\nAdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;\n// in the interrupt function:\nAdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;\nPieCtrlRegs.PIEACK.all = PIEACK_GROUP1;",
    hot: ["int", "w-int"],
  },
];

/** The path from a trigger to a result, TRM sections 11.5 and 11.9. */
function AdcChain() {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const on = (id: string) => (s.hot.includes(id) ? "hot" : "");
  return (
    <figure className="figure adcch" aria-label="Step-through diagram of an ADC conversion from trigger to interrupt">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 190" role="img" aria-label={`${s.title}. ${s.text}`}>
        {/* triggers */}
        <text x="42" y="14" textAnchor="middle" className="fig-label dim">WHEN</text>
        <rect x="6" y="20" width="72" height="26" rx="4" className={`fig-box ${on("trig")}`} />
        <text x="42" y="31" textAnchor="middle" className="fig-label">ePWM4</text>
        <text x="42" y="42" textAnchor="middle" className="fig-label dim">SOCA pulse</text>
        <rect x="6" y="52" width="72" height="18" rx="4" className="fig-box" strokeDasharray="3 2" />
        <text x="42" y="64" textAnchor="middle" className="fig-label dim">CPU timer</text>
        <rect x="6" y="74" width="72" height="18" rx="4" className="fig-box" strokeDasharray="3 2" />
        <text x="42" y="86" textAnchor="middle" className="fig-label dim">software</text>
        <path d="M78 33 H104" className={`fig-wire arrow ${on("w-trig")}`} markerEnd="url(#fig-arrow)" />
        {/* SOC slots */}
        <text x="146" y="14" textAnchor="middle" className="fig-label dim">16 SLOTS</text>
        <rect x="106" y="20" width="80" height="50" rx="4" className={`fig-box ${on("soc")}`} />
        <text x="146" y="32" textAnchor="middle" className="fig-label">SOC0</text>
        <text x="146" y="44" textAnchor="middle" className="fig-value small">TRIGSEL 11</text>
        <text x="146" y="55" textAnchor="middle" className="fig-value small">CHSEL 4</text>
        <text x="146" y="66" textAnchor="middle" className="fig-value small">ACQPS 99</text>
        <rect x="106" y="74" width="80" height="14" rx="3" className="fig-box" strokeDasharray="3 2" />
        <text x="146" y="84" textAnchor="middle" className="fig-label dim">SOC1</text>
        <rect x="106" y="91" width="80" height="14" rx="3" className="fig-box" strokeDasharray="3 2" />
        <text x="146" y="101" textAnchor="middle" className="fig-label dim">SOC2 ... SOC15</text>
        {/* pins */}
        <text x="42" y="124" textAnchor="middle" className="fig-label dim">WHICH PIN</text>
        <rect x="6" y="130" width="72" height="50" rx="4" className={`fig-box ${on("pins")}`} />
        <text x="42" y="143" textAnchor="middle" className="fig-label dim">ADCINA2</text>
        <text x="42" y="155" textAnchor="middle" className="fig-label dim">ADCINA3</text>
        <text x="42" y="167" textAnchor="middle" className={`fig-label ${s.hot.includes("pins") || s.hot.includes("sh") ? "" : "dim"}`}>ADCINA4</text>
        <path d="M78 163 H212 V112" className={`fig-wire arrow ${on("w-pin")}`} markerEnd="url(#fig-arrow)" />
        <path d="M146 105 V163" className={`fig-wire ${on("w-pin")}`} strokeDasharray="2 2" />
        <text x="150" y="135" className="fig-label dim">CHSEL picks</text>
        {/* converter */}
        <text x="232" y="14" textAnchor="middle" className="fig-label dim">ONE CONVERTER</text>
        <rect x="196" y="74" width="72" height="36" rx="4" className={`fig-box ${on("sh")}`} />
        <text x="232" y="88" textAnchor="middle" className="fig-label">sample</text>
        <text x="232" y="100" textAnchor="middle" className="fig-label">and hold</text>
        <path d="M232 74 V60" className={`fig-wire arrow ${on("w-sar")}`} markerEnd="url(#fig-arrow)" />
        <rect x="196" y="20" width="72" height="38" rx="4" className={`fig-box ${on("sar")}`} />
        <text x="232" y="35" textAnchor="middle" className="fig-label">12-bit</text>
        <text x="232" y="47" textAnchor="middle" className="fig-label">converter</text>
        <path d="M268 39 H292" className={`fig-wire arrow ${on("w-res")}`} markerEnd="url(#fig-arrow)" />
        {/* results */}
        <text x="330" y="14" textAnchor="middle" className="fig-label dim">RESULTS</text>
        <rect x="294" y="20" width="72" height="38" rx="4" className={`fig-box ${on("res")}`} />
        <text x="330" y="35" textAnchor="middle" className="fig-label">ADCRESULT0</text>
        <text x="330" y="48" textAnchor="middle" className="fig-value small">{i >= 6 ? "1638" : "----"}</text>
        <rect x="294" y="62" width="72" height="14" rx="3" className="fig-box" strokeDasharray="3 2" />
        <text x="330" y="72" textAnchor="middle" className="fig-label dim">ADCRESULT1 ...</text>
        <path d="M330 76 V118" className={`fig-wire arrow ${on("w-int")}`} markerEnd="url(#fig-arrow)" />
        {/* interrupt */}
        <rect x="278" y="120" width="136" height="60" rx="4" className={`fig-box ${on("int")}`} />
        <text x="346" y="134" textAnchor="middle" className="fig-label">INT1SEL = 0: SOC0 done</text>
        <text x="346" y="147" textAnchor="middle" className="fig-label">raises ADCINT1</text>
        <text x="346" y="161" textAnchor="middle" className="fig-label dim">PIE group 1, channel 1</text>
        <text x="346" y="174" textAnchor="middle" className="fig-label dim">your interrupt function</text>
        <defs>
          <marker id="fig-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="fig-arrowhead" />
          </marker>
        </defs>
      </svg>
      <div className="fig-step" role="status">
        <strong>{s.title}</strong>
        <p>{s.text}</p>
        <pre><code>{s.code}</code></pre>
      </div>
      <div className="fig-controls row">
        <button className="btn small" onClick={() => setI(i - 1)} disabled={i === 0}>Back</button>
        <button className="btn small primary" onClick={() => setI(i + 1)} disabled={i === STEPS.length - 1}>Next</button>
        <button className="btn small" onClick={() => setI(0)} disabled={i === 0}>Reset</button>
        <span className="fig-dots" aria-hidden="true">{STEPS.map((_, k) => (<i key={k} className={k === i ? "on" : ""} />))}</span>
      </div>
      <figcaption>One conversion, from trigger to interrupt. In this example ePWM4 triggers SOC0, which measures pin ADCINA4. The pin is at 1.2 V, so the result is 4096 x 1.2 / 3.0 = 1638. Dashed boxes are the triggers, slots and results this example does not use.</figcaption>
    </figure>
  );
}

export const figure = { id: "adc-chain", Component: AdcChain };
