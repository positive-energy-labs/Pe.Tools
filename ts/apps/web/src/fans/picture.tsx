/**
 * The /fans picture slot's overlay (ADR 0035 rule 2): what the closed marks cannot express of the
 * open fans' walk, handed to the kernel's picture pane as parts. The walk's drawing is the duct
 * sheet's own (`ducts/sheet/picture.tsx`); this file only adapts the route's context to it. It
 * mounts no picture: the kernel pane owns capture, pose, selection, marks and findings.
 */
import { systemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { useRef } from "react";
import { SheetPicture } from "../ducts/sheet/picture.tsx";
import type { PictureOverlayProps } from "../route/slots/picture/overlay.tsx";
import { SheetEmpty, SheetFrame, sheetSnapshot, useSheetData } from "./mount.tsx";
import type { FansDrawContext } from "./route.ts";
import type { FanEspValues, Immutable } from "@pe/agent-contracts";

type Props = PictureOverlayProps<FansDrawContext>;

const inWg = (value: number) => `${value.toFixed(2)} in-wg`;
/**
 * What the picture must say about a fan's ESP: rated is what the unit states, required is the
 * engine's claim, staged is what Work would write. They are three facts and never stand in for one
 * another, so a required value that is not a complete claim is named as partial, with its reach.
 */
export function espWarnings({ rated, required, staged }: Immutable<FanEspValues>): string[] {
  if (required.kind !== "complete")
    return [`Required ESP is not known: ${required.kind === "to-boundary" ? `priced to ${required.boundaries.length} unruled boundar${required.boundaries.length === 1 ? "y" : "ies"}` : `${required.coverage.length} coverage gap${required.coverage.length === 1 ? "" : "s"}, ${required.blockingIds.length} blocking`}; ${inWg(required.knownInWg)} so far`];
  const need = required.requiredEspInWg;
  return [
    ...(rated.status === "invalid" ? [`Rated ESP is unreadable (${rated.source} ${rated.ref})`] : []),
    ...(rated.status === "valid" && rated.value < need ? [`Rated ESP ${inWg(rated.value)} is below the required ${inWg(need)}`] : []),
    ...(staged.status === "valid" && Math.abs(staged.value - need) > 0.005 ? [`Staged ESP ${inWg(staged.value)} differs from the required ${inWg(need)}`] : []),
  ];
}

export function FanPicture({ ctx, picture }: Props) {
  const snapshot = sheetSnapshot(ctx.value.value?.sheetSnapshot);
  return "kind" in snapshot ? <SheetEmpty value={ctx.value} /> : <FanWalk ctx={ctx} snapshot={snapshot} picture={picture} />;
}

function FanWalk({ ctx, snapshot, picture }: Pick<Props, "ctx" | "picture"> & { snapshot: DuctSnapshot & { sourceVersion?: string } }) {
  const { authored, value, sheet, roster, nameOf, issue, state, fanKey } = useSheetData(ctx, snapshot);
  const picked = authored.fan.kind === "all" ? "all" : authored.fan.ids;
  const jump = useRef<((key: SubjectKey) => void) | null>(null);
  const esp = sheet?.overview.espValues;
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf} jump={jump}>
      {/* Served once the engine's claim rides the overview; until then there is nothing to warn from. */}
      {esp && espWarnings(esp).map((warning) => <p key={warning} role="alert">{warning}</p>)}
      <SheetPicture
        props={{
          page: { layers: authored.layers, context: authored.context, encoding: authored.encoding, issue },
          pose: (patch) => void ctx.page.pose(patch, "named"),
          select: (key) => void ctx.selection.set([{ kind: "focus", id: key }]),
          work: { doc: ctx.value.value?.design ?? null },
          source: { version: snapshot.sourceVersion ?? "", current: ctx.value.state === "ready" },
        }}
        snapshot={snapshot}
        sheet={sheet}
        opened={value?.opened}
        fans={roster.filter((row) => picked === "all" || picked.includes(fanKey(row)))}
        blockers={state.blockers}
        systemFans={(system) => {
          // A system's fans: the units on the runs that price it, or the roster's own word.
          const units = systemScope(snapshot, system).units;
          return roster.filter((row) => row.system === system || units.has(row.unitId)).map(fanKey);
        }}
        picture={picture}
        jump={jump}
      />
    </SheetFrame>
  );
}
