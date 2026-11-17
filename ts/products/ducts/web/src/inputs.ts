/** The fan-out as the chip says it. */
export const clearWords = ({ grilles, systems }: { grilles: number; systems: number }) =>
  `moves ${grilles} grille${grilles === 1 ? "" : "s"} in ${systems} system${systems === 1 ? "" : "s"}`;
