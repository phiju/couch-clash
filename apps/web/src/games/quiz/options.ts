/**
 * Colors + shapes for the four answer options (shapes help color-blind players).
 * All from the show palette; every option has a bulb border like the buttons.
 */
export const QUIZ_OPTION_STYLES = [
  { bg: "bg-orange text-cream", shadow: "shadow-[0_6px_0_var(--color-brown)]", shape: "▲" },
  { bg: "bg-petrol text-cream", shadow: "shadow-[0_6px_0_var(--color-petrol-dark)]", shape: "◆" },
  { bg: "bg-bulb text-brown", shadow: "shadow-[0_6px_0_var(--color-brown)]", shape: "●" },
  { bg: "bg-brown text-cream", shadow: "shadow-[0_6px_0_#2e1309]", shape: "■" },
] as const;
