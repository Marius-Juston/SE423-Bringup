import { RegisterPageView } from "./register-page-view";

// The page of ADCSOC0CTL (TRM 11.16.2.17, Figure 11-42, Table 11-32), open
// on TRIGSEL: its description is the list of every trigger an ADC start of
// conversion can have. The course's condensed ADC reference is this page.

function AdcTriggerTable() {
  return <RegisterPageView initial="AdcaRegs.ADCSOC0CTL" field="TRIGSEL" />;
}

export const figure = {
  id: "adc-trigger-table",
  title: "ADC trigger table",
  description: "The manual's page of the register that says what starts a conversion and which input it measures. Choose a field and read its list of values.",
  Component: AdcTriggerTable,
};
