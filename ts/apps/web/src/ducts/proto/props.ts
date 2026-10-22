/** The one props object `route.tsx` hands the shell: the reads, the page, the Work and the selection callbacks. */
import type { DuctClaim, DuctsRouteDocument, OrbitViewport } from "@pe/agent-contracts";
import type { price } from "@pe/ducts-domain/pricing";
import type { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { ActionHandle } from "#/route/handle";
import type { PageMove } from "#/route/manifest";

import type { DuctsPage } from "../manifest";
import type { Claim } from "../legs";
import type { Subject } from "../legs";

export interface ProtoProps {
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
  /** Subject scene (ids + claims + verdict callback); null until a subject exists. */
  subject: Subject | null;
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
  onHover: (id: number | null) => void;
  hovered: number | null;
  /** Work doc and its writer, as the views get them (`preview` is the last evaluation response). */
  work: {
    doc: DuctsRouteDocument | null;
    revision: number | null;
    write: (patches: never) => Promise<unknown> | void;
    preview: unknown;
  };
  /** Empty-state words, or null when the snapshot is drawable. */
  empty: { says: string; exit: string } | null;
  /** The bound document (session/openId), or null. Unread: element targets come from the
   * displayed observation (`useNativeObservation`); goes when `route.tsx` stops passing it. */
  doc: { session: string; openId: string } | null;
  /** Loading state of the host reads. */
  reading: { pending: boolean; error: string | null };
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
  /** How many changes a write would carry: staged cells and pending rulings. */
  staged: number;
}
