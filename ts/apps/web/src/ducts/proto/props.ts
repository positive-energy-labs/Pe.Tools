/**
 * THROWAWAY (protoui round 1): the one props object every ducts variant receives. It carries
 * everything the current views are handed by `route.tsx`; the data layer is not touched.
 */
import type { DuctClaim, DuctsRouteDocument } from "@pe/agent-contracts";
import type { price } from "@pe/ducts-domain/pricing";
import type { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import type { DuctsPage } from "../manifest";
import type { Claim } from "../legs";
import type { Subject } from "../spatial";

export interface ProtoProps {
  /** Null only while reading or with no document; the fixture stands in under `?variant=`. */
  snapshot: DuctSnapshot | null;
  /** True when the snapshot is `scene.fixture.ts`, not a host read. */
  fromFixture: boolean;
  /** Pe's priced losses (now/next); null until the ASHRAE tables are read. */
  priced: ReturnType<typeof price> | null;
  /** Catalog findings (prose), as route.tsx draws them above the body. */
  findings: readonly string[];
  /** Per-group readiness. */
  ready: ReturnType<typeof readiness>;
  /** Subject scene (ids + claims + verdict callback); null until a subject exists. */
  subject: Subject | null;
  /** The subject's claims, flattened (same array as subject.claims; empty when none). */
  claims: readonly Claim[];
  /** The claim cells keyed by id as the fixture/Work holds them. */
  claimCells: Record<string, DuctClaim>;
  /** Route page state (selected, issue, group, level, layers, encoding, scene, view, ...). */
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
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
  /** The bound document (session/openId), or null. */
  doc: { session: string; openId: string } | null;
  /** Loading state of the host reads. */
  reading: { pending: boolean; error: string | null };
}
