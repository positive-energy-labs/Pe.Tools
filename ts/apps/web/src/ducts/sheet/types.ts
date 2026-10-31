/**
 * The fan sheet's spine API (protoui rounds 1 to 3, 2026-10-28): the one props object the sheet view
 * takes. The view lays out and prioritises; it never re-derives a tier, a layer, a roster adapter or
 * the inputs surface. What is shared lives in this folder, once.
 */
import type { ReactNode } from "react";
import type { DuctsInputs, DuctsSheetEdits, DuctsSheetRequest } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import type { FanPort } from "./model";
import type { Closer } from "./closer";
import type { OpenSheet } from "../sources";
import type { SheetBlocker, Tier } from "./tiers";

/** The open sheet's resolved criteria and firm layer (ducts LEDGER 2026-10-29), or null until a sheet's inputs land. */
export type SheetCriteria = DuctsInputs["criteria"];
export interface SheetFirm {
  version: string;
  path: string;
  present: boolean;
}

export interface SheetViewProps {
  snapshot: DuctSnapshot;
  /** Every fan port, roster order (incomplete first); each row's state as last computed. */
  roster: readonly FanPort[];
  /** The open fan sheet, or null until one is opened. */
  sheet: OpenSheet | null;
  /** The open sheet's blockers in detail (closer note and candidate when inputs detail has landed). */
  blockers: readonly SheetBlocker[];
  /** Blocker count by consent tier for the open sheet; zero everywhere means one-click calc. */
  tiers: Record<Tier, number>;
  /** Engine closures already taken silently (auto-joins, firm defaults with provenance), as text. */
  taken: readonly string[];
  slots: readonly { slot: string; covered: number; total: number }[];
  activeSlot: string;
  /** Everything the open sheet priced from, resolved with sources; null until its inputs detail lands. */
  inputs: DuctsInputs | null;
  firm: SheetFirm | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  progress: { done: number; total: number; mark: string; stopped: boolean } | null;
  /** Open (compute) one fan's sheet; compute every fan's overview; cancel what runs. */
  open: (fan: Pick<FanPort, "unitId" | "portIndex">) => void;
  computeAll: () => void;
  cancel: () => void;
  refresh: () => void;
  /** Edits on Work's own keys through the open sheet (typed cfm and drops, rulings, criteria); the host recomputes. */
  changeInputs: (edits: DuctsSheetEdits) => void;
  /** A basis-bound calculation ruling on a heal proposal pair; never a Revit write. */
  rule: (proposal: NonNullable<DuctsSheetRequest["proposal"]>) => void;
  pickPath: (pathId: string) => void;
  /** A blocker's closer: verb text, refusal (null when live), the inline input it needs and its
   * action; `typed` is the row's input value. `close` runs a live closer: a ruling on the pair
   * (a Revit heal write has no door yet, `SHIM(ducts-sheet-write)`), a typed drop, a typed cfm. */
  closerOf: (blocker: SheetBlocker, typed: number | null) => Closer;
  close: (closer: Closer) => void;
  closeMany: (closers: readonly Closer[]) => void;
  /** The blocker whose row is focused (its pin was picked on the picture), by id. */
  focusedBlocker: string | null;
  focusBlocker: (id: string | null) => void;
  /** The /ducts picture with the sheet's layers, pins, hover and pick already wired, rendered
   * through the layout's pane renderer so it gets the house strip, readout and overlay plumbing. */
  picture: (renderPane: TeachingPaneRender) => ReactNode;
  /** The one inputs surface: four groups (firm, project, this fan, this element), every census row. */
  inputsSurface: ReactNode;
}
