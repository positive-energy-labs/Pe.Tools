import type { DuctsRouteDocument, DuctSystemColours } from "@pe/agent-contracts";

// UNPROVEN: sampled plan convention, awaiting kaitpw's verdict after use. Editable in Settings.
// Pixel census: .artifacts/runs/ducts-multisystem-20261024/b1/colours/sample-and-census.json.
export const FIRM_COLOURS: Readonly<DuctSystemColours> = Object.freeze({
  supply: "#0569a5",
  return: "#02bba4",
  exhaust: "#fea665",
  fresh: "#1cbcd5",
  unknown: "#808080", // Neutral fallback, not a sampled firm convention.
});

export const coloursOf = (doc: DuctsRouteDocument | null): Readonly<DuctSystemColours> =>
  doc?.systemColours?.edit?.value ?? FIRM_COLOURS;
