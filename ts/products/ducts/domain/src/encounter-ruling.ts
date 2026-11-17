import type { Author } from "@pe/agent-contracts";
/** A person's verdict on one encounter, by where it sits. */
export interface EncounterRuling {
  at: { elementId: number; connector: number };
  verdict: "accepted" | "refused";
  /** Who staged the ruling and where (P-029): a ruling no known caller stamped never reaches here. */
  by: Author;
  ref: string;
}
export const ENCOUNTER_KEY = (at: EncounterRuling["at"]) =>
  `encounter:${at.elementId}:${at.connector}`;
