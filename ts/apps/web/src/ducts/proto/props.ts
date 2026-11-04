import { useCallback } from "react";
import { localId } from "../neutral";
import type * as Atom from "effect/reactivity/Atom";
import type { SubjectKey } from "@pe/kit/lang/attention";
import type { DuctsDesign, OrbitViewport } from "@pe/agent-contracts";
import type { price } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { ReactNode } from "react";
import type { History } from "@pe/agent-contracts";

import type { DuctsPage } from "../page";
import type { HealReview } from "../reviews";
import type { Claim, Run } from "../legs";
import type { PricingResult } from "../pricing-job";

// ProtoProps survives for picture/SystemsList/DuctsOwner; U1b replaces with real per-pane bodies
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
  /** Document-wide projections share the worker's Work revision; null before the first solve. */
  analysis: PricingResult["analysis"] | null;
  /** Run scene (ids + claims + verdict callback); null until a subject exists. */
  subject: Run | null;
  /** Stages a person's verdict on a claim; present whether or not a subject exists. */
  onVerdict: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => void;
  /** The chosen system's claims (every claim when no system is chosen). */
  claims: readonly Claim[];
  /** Route page state (selected, issue, system, level, layers, encoding, picture, viewport, ...). */
  page: Omit<DuctsPage, "system"> & {
    system: string[];
    /** The open system write, heal and fan act on; "" with none (`activeName`). */
    active: string;
    heal: HealReview | null;
  };
  /** A named move pushes, a gesture replaces (`PageMove`). */
  setPage: (
    next: Partial<Omit<DuctsPage, "system" | "fan" | "stage" | "heal">>,
    move?: { readonly history?: History },
  ) => void;
  /** Reports the committed renderer pose as derived facts; never writes Page or gesture previews. */
  onPose?: (pose: OrbitViewport | null) => void;
  /** Selection / hover callbacks over element ids and claims. */
  onSelect: (id: number | null) => void;
  /** Work doc and its writer. Every write invokes the kernel Work verb. */
  work: {
    doc: DuctsDesign | null;
    revision: number | null;
    write: import("../work").LossesWork["write"];
  };
  /** Empty-state words, or null when the snapshot is drawable. */
  empty: { says: string; exit: string } | null;
  /** Bound document fallback for visual retention while capture readiness is withdrawn.
   * Element action targets come only from the displayed native observation. */
  doc: { session: string; openId: string } | null;
  /** Loading state of the host reads. `refreshing`: a re-read is in flight or pricing, and the
   * screen draws the last priced read until it lands. */
  reading: { pending: boolean; error: string | null; refreshing: boolean };
  /** Pane placements render the kernel's controls; no preview state or lifecycle exists here. */
  commands: (row?: unknown) => ReactNode;
  cells: (row: { segment: string; key: string }) => ReactNode;
  /** How many changes a write would carry: edit cells and pending rulings. */
  edit: number;
  /** Coverage of the explicitly chosen Revit systems. */
  coverage?: {
    read: number;
    of: number;
    reading: readonly string[];
    report?: string;
  } | null;
}

// The remaining picture/SystemsList consumers use their existing callback until U1b recuts them.
export function useProtoPage(
  pagePort: Pick<
    import("../../../../../packages/agent-contracts/src/route-kernel-bodies").PaneContext<
      typeof import("../neutral").ductsData,
      typeof import("../neutral").schemas,
      typeof import("../neutral").entries,
      keyof typeof import("../neutral").ductsData.panes
    >["page"],
    "select" | "pose"
  >,
  browse: (input: import("zod").z.output<typeof import("../neutral").schemas.browse>) => unknown,
): ProtoProps["setPage"] {
  return useCallback<ProtoProps["setPage"]>(
    (next, move) => {
      const {
        selected,
        contextRadiusFt,
        sceneView,
        encoding,
        layers,
        contextStyle,
        picture,
        viewport,
        ...query
      } = next;
      if (selected !== undefined)
        pagePort.select(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
      const pose = {
        ...(contextRadiusFt !== undefined && { contextRadiusFt }),
        ...(sceneView !== undefined && { sceneView }),
        ...(encoding !== undefined && { encoding }),
        ...(layers !== undefined && { layers }),
        ...(contextStyle !== undefined && { contextStyle }),
        ...(picture !== undefined && { picture }),
        ...(viewport !== undefined && { viewport }),
      };
      if (Object.keys(pose).length)
        pagePort.pose(pose, move?.history === "replace" ? "gesture" : "named");
      if (Object.keys(query).length) browse(query);
    },
    [pagePort, browse],
  );
}
