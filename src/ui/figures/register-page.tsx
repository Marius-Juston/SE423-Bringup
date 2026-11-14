import { RegisterPageView } from "./register-page-view";

// A register description page of the Technical Reference Manual, opening on
// the CPU timer's control register (3.15.2.3 TCR, Figure 3-27, Table 3-22).

function RegisterPage() {
  return <RegisterPageView initial="CpuTimer0Regs.TCR" />;
}

export const figure = {
  id: "register-page",
  title: "A register page",
  description: "A register as the reference manual prints it: the picture of its bits and the table of its fields. Choose a field to see what its type and reset value mean and the C that reads or writes it.",
  Component: RegisterPage,
};
