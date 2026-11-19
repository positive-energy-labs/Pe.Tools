/**
 * The /fans picture slot's overlay (ADR 0035 rule 2): what the closed marks cannot express of the
 * open fans' walk, handed to the kernel's picture pane as parts. The walk's drawing is the duct
 * sheet's own (`ducts/sheet/picture.tsx`); this file only adapts the route's context to it. It
 * mounts no picture: the kernel pane owns capture, pose, selection, marks and findings.
 */
import { systemScope } from "@pe/ducts-domain/system-scope";
import { espWord } from "@pe/agent-contracts/slots";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { useRef } from "react";
import { CalcPicture } from "./calc/picture.tsx";
import type { PictureOverlayProps } from "@pe/web/route/slots/picture/overlay";
import { CalcEmpty, CalcFrame, calcSnapshot, useCalcData } from "./mount.tsx";
import type { FansDrawContext } from "../route.ts";
import type { FanEspValues, Immutable } from "@pe/agent-contracts";

type Props = PictureOverlayProps<FansDrawContext>;

const inWg = (value: number) => `${value.toFixed(2)} in-wg`;
/**
 * What the picture must say about a fan's ESP: rated is what the unit states, required is the
 * engine's claim. They are separate facts and never stand in for one
 * another, so a required value that is not a complete claim is named as partial, with its reach.
 */
export function espWarnings({ rated, required }: Immutable<FanEspValues>): string[] {
  if (required.kind !== "complete")
    return [`Required ESP is not known: ${required.kind === "to-boundary" ? `priced to ${required.boundaries.length} unruled boundar${required.boundaries.length === 1 ? "y" : "ies"}` : `${required.coverage.length} coverage gap${required.coverage.length === 1 ? "" : "s"}, ${required.blockingIds.length} blocking`}; ${inWg(required.knownInWg)} so far`];
  const need = required.requiredEspInWg;
  return [
    ...(rated.status === "invalid" ? [`Rated ESP is unreadable (${rated.source} ${rated.ref})`] : []),
    ...(rated.status === "valid" && rated.value < need ? [`Rated ESP ${inWg(rated.value)} (${rated.source} ${rated.ref}) is below the required ${inWg(need)} (${espWord(true)})`] : []),
  ];
}

export function FanPicture({ ctx, picture }: Props) {
  const snapshot = calcSnapshot(ctx.value.value?.calcSnapshot);
  return "kind" in snapshot ? <CalcEmpty value={ctx.value} /> : <FanWalk ctx={ctx} snapshot={snapshot} picture={picture} />;
}

function FanWalk({ ctx, snapshot, picture }: Pick<Props, "ctx" | "picture"> & { snapshot: DuctSnapshot & { sourceVersion?: string } }) {
  const { authored, value, sheet, roster, nameOf, issue, state, fanKey } = useCalcData(ctx, snapshot);
  const picked = authored.fan.kind === "all" ? "all" : authored.fan.ids;
  const jump = useRef<((key: SubjectKey) => void) | null>(null);
  const esp = sheet?.overview.espValues, direction = sheet?.overview.fan?.directionMismatch?.evidence;
  return (
    <CalcFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf} jump={jump}>
      {[...(direction ? [`Family direction differs from the network: ${direction}`] : []), ...(esp ? espWarnings(esp) : [])]
        .map((warning) => <p key={warning} role="alert">{warning}</p>)}
      <CalcPicture
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
    </CalcFrame>
  );
}
