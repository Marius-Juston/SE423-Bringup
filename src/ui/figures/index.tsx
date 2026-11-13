import type { ReactNode } from "react";
import type { FigureId } from "../../levels/figures";
import { GpioPin } from "./GpioPin";
import { AdcChain } from "./AdcChain";
import { SpiModes } from "./SpiModes";

const TABLE: Record<FigureId, () => ReactNode> = {
  "gpio-pin": () => <GpioPin />,
  "adc-chain": () => <AdcChain />,
  "spi-modes": () => <SpiModes />,
};

export function Figure({ id }: { id: string }) {
  const f = TABLE[id as FigureId];
  return f ? <>{f()}</> : <p className="fig-missing">[missing figure: {id}]</p>;
}
