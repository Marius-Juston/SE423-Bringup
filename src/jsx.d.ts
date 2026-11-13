// React 19 no longer declares a global JSX namespace; figures and views may
// still write `JSX.Element`.
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
  }
}
