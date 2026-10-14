// Copper K method at 75 C, unity power factor, negligible reactance.
// Formula and circular-mil areas: IAEI, Voltage Drop Formulas (March 2017).
export const sizes = [
  ["14", 4110], ["12", 6530], ["10", 10380], ["8", 16510], ["6", 26240],
  ["4", 41740], ["3", 52620], ["2", 66360], ["1", 83690], ["1/0", 105600],
].map(([size, area]) => ({ size, area }));

export function calculate({ size, length, amps, voltage, phase }) {
  const conductor = sizes.find((row) => row.size === size);
  if (!conductor || !["1", "3"].includes(phase)) throw new Error("Choose a conductor and phase.");
  if (![length, amps, voltage].every((n) => typeof n === "number" && Number.isFinite(n)) || length < 0 || amps < 0 || voltage <= 0)
    throw new Error("Enter a nonnegative length and load, and a voltage greater than zero.");
  const multiplier = phase === "1" ? 2 : Math.sqrt(3);
  const drop = multiplier * 12.9 * amps * length / conductor.area;
  return { drop, percent: 100 * drop / voltage, delivered: voltage - drop, area: conductor.area, multiplier };
}
