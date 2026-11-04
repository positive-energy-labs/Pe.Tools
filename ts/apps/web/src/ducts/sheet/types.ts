import type { DuctsSheetEdits } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { ListPersist } from "@pe/kit/lang/collection";
import type { OpenSheet } from "../neutral";
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
  snapshot: DuctSnapshot;
  address?: ListPersist<"name">;
  roster: readonly FanPort[];
  picked?: readonly string[];
  open: (row: FanPort) => void;
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
  changeInputs: (edits: DuctsSheetEdits) => void;
  closerOf: (blocker: SheetBlocker, typed: number | null) => Closer;
  close: (closer: Closer) => void;
  closeMany: (closers: readonly Closer[]) => void;
  focusedBlocker: string | null;
  focusBlocker: (id: string | null) => void;
}
