import type { SheetEdits } from "@pe/agent-contracts";
import type { ValueHandle, ListPersist } from "@pe/kit/lang/collection";
import { openFanSheetSchema } from "@pe/agent-contracts";
import type { Immutable } from "@pe/agent-contracts";
import type { z } from "zod";
export type OpenSheet = Immutable<z.output<typeof openFanSheetSchema>>;
import type { Closer } from "./closer";
import type { FanPort, SheetInputs } from "./model";
import type { SheetBlocker } from "./tiers";

export type SheetCriteria = SheetInputs["criteria"];
export interface SheetFirm {
  version: string;
  path: string;
  present: boolean;
}
/** Presentation leaves receive only the data their own pane draws. */
export interface RosterProps {
  value?: ValueHandle<unknown>;
  nameOf: (id: number) => string;
  address?: ListPersist<"name">;
  roster: readonly FanPort[];
  picked?: readonly string[];
  open: (row: FanPort) => void;
  /** The row verb's write: a person's finding on one fan port (`findings.write`). */
  finding: (finding: import("@pe/agent-contracts/slots").FindingInput) => Promise<unknown>;
  busy: boolean;
  loading: boolean;
}
export interface LedgerProps {
  sheet: OpenSheet | null;
  blockers: readonly SheetBlocker[];
  taken: readonly string[];
  inputs: SheetInputs | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  changeInputs: (edits: SheetEdits) => void;
  closerOf: (blocker: SheetBlocker, typed: number | null) => Closer;
  close: (closer: Closer) => void;
  closeMany: (closers: readonly Closer[]) => void;
  focusedBlocker: string | null;
  focusBlocker: (id: string | null) => void;
}
