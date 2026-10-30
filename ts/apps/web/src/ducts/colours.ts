import { DUCT_AIR_TYPES, type DuctSystemColours } from "@pe/agent-contracts";
import { defaultDuctSettings } from "./settings";

/** Palette settings affect the picture only; they never enter Work or native requests. */
export const coloursOf = (
  settings: Readonly<Record<string, unknown>> | null,
): Readonly<DuctSystemColours> =>
  Object.fromEntries(
    DUCT_AIR_TYPES.map((type) => [
      type,
      settings?.[`${type}Colour`] ?? defaultDuctSettings[`${type}Colour`],
    ]),
  ) as DuctSystemColours;
export const FIRM_COLOURS = Object.freeze(coloursOf(null));
