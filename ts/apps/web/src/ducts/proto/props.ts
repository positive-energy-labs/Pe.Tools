import type * as Atom from "effect/unstable/reactivity/Atom";
import type { SubjectKey } from "@pe/kit/lang/attention";
/** The one props object `route.tsx` hands the shell: the reads, the page, the Work and the selection callbacks. */
import type { DuctClaim, DuctsRouteDocument, OrbitViewport } from "@pe/agent-contracts";
import type { price } from "@pe/ducts-domain/pricing";
import type { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { ActionHandle } from "#/route/handle";
import type { PageMove } from "#/route/manifest";

import type { DuctsPage } from "../manifest";
import type { Claim, Run } from "../legs";
import type { PricingResult } from "../pricing-job";

export interface ProtoProps {
  /** Geometry follows the native snapshot revision, independently of pending pricing. */
  captureSource?: { document: { session: string; openId: string }; version: string } | null;
  attentionDoc: string;
  selection: Atom.Atom<ReadonlySet<SubjectKey>>;
  /** Null only while reading or with no document. */
  snapshot: DuctSnapshot | null;
  /** Pe's priced losses (now/next); null until the ASHRAE tables are read. */
  priced: ReturnType<typeof price> | null;
  /** The snapshot and tables are in and the price is still being computed (a few seconds). */
  pricing: boolean;
  /** Catalog findings (prose), as route.tsx draws them above the body. */
  findings: readonly string[];
  /** Per-group readiness (internal keys). */
  ready: ReturnType<typeof readiness>;
  /** Document-wide projections share the worker's Work revision; null before the first solve. */
  analysis: PricingResult["analysis"] | null;
  /** Run scene (ids + claims + verdict callback); null until a subject exists. */
  subject: Run | null;
  /** Stages a person's verdict on a claim; present whether or not a subject exists. */
  onVerdict: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => void;
  /** The chosen system's claims (every claim when no system is chosen). */
  claims: readonly Claim[];
  /** The claim cells keyed by id as the Work (or the `?demo=scene` fixture) holds them. */
  claimCells: Record<string, DuctClaim>;
  /** Route page state (selected, issue, system, level, layers, encoding, picture, viewport, ...). */
  page: DuctsPage;
  /** A named move pushes, a gesture replaces (`PageMove`). */
  setPage: (next: Partial<DuctsPage>, move?: PageMove<DuctsPage>) => void;
  /** Reports the committed renderer pose as derived facts; never writes Page or gesture previews. */
  onPose?: (pose: OrbitViewport | null) => void;
  /** Selection / hover callbacks over element ids and claims. */
  onSelect: (id: number | null) => void;
  onSelectClaim: (claim: Claim) => void;
  /** Work doc and its writer, as the views get them (`preview` is the last evaluation response). */
  work: {
    doc: DuctsRouteDocument | null;
    revision: number | null;
    write: (patches: never) => Promise<unknown> | void;
    preview: unknown;
  };
  /** Empty-state words, or null when the snapshot is drawable. */
  empty: { says: string; exit: string } | null;
  /** Bound document fallback for visual retention while capture readiness is withdrawn.
   * Element action targets come only from the displayed native observation. */
  doc: { session: string; openId: string } | null;
  /** Loading state of the host reads. `refreshing`: a re-read is in flight or pricing, and the
   * screen draws the last priced read until it lands. */
  reading: { pending: boolean; error: string | null; refreshing: boolean };
  /** The route's preview and apply as the handle arms or refuses them; the Write group draws both. */
  actions: {
    preview: ActionHandle;
    apply: ActionHandle;
    /** A group's heal preview and heal; the Heal row runs them with its group. */
    healPreview: ActionHandle;
    heal: ActionHandle;
    /** Make a unit a system's fan (base equipment) in Revit: preview, then apply. */
    fanPreview: ActionHandle;
    fan: ActionHandle;
    busy: boolean;
  };
  /** How many changes a write would carry: edit cells and pending rulings. */
  edit: number;
  /** How many of the document's Revit systems the snapshot holds when the network stage reads by
   * system (`system-reads.ts`): document-wide panes say they are partial and offer `readAll`, which
   * reads the rest a few systems at a time (null once asked or done). Absent: the whole document. */
  coverage?: {
    read: number;
    of: number;
    reading: readonly string[];
    readAll: (() => void) | null;
  } | null;
}
