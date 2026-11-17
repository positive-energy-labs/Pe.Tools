import type { CalcEdits } from "@pe/agent-contracts";
import type { ValueHandle, ListPersist } from "@pe/kit/lang/collection";
import { openFanCalcSchema } from "@pe/agent-contracts";
import type { Immutable } from "@pe/agent-contracts";
import type { z } from "zod";
export type OpenCalc = Immutable<z.output<typeof openFanCalcSchema>>;
import type { Closer } from "./closer.ts";
import type { FanPort, CalcInputs } from "@pe/ducts-web/calc/model";
import type { CalcBlocker } from "./tiers.ts";

export type CalcCriteria = CalcInputs["criteria"];
export type CalcFirm = Exclude<import("@pe/ducts-contract/duct-inputs").DuctFirmLine, { refused: string }>;
/** Presentation leaves receive only the data their own pane draws. */
export interface RosterProps {
  value?: ValueHandle<unknown>;
  nameOf: (id: number) => string;
  address?: ListPersist<"name">;
  roster: readonly FanPort[];
  picked?: readonly string[];
  open: (row: FanPort) => void;
  busy: boolean;
  loading: boolean;
}
export interface LedgerProps {
  subjectFor?: (id: number) => string;
  sheet: OpenCalc | null;
  blockers: readonly CalcBlocker[];
  taken: readonly string[];
  inputs: CalcInputs | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  changeInputs: (edits: CalcEdits) => void;
  closerOf: (blocker: CalcBlocker, typed: number | null) => Closer;
  close: (closer: Closer) => void;
  closeMany: (closers: readonly Closer[]) => void;
  focusedBlocker: string | null;
  focusBlocker: (id: string | null) => void;
}
