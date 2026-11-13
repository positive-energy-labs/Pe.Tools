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

type Props = PictureOverlayProps<FansDrawContext>;

export function FanPicture({ ctx, picture }: Props) {
  const snapshot = sheetSnapshot(ctx.value.value?.sheetSnapshot);
  return "kind" in snapshot ? <SheetEmpty value={ctx.value} /> : <FanWalk ctx={ctx} snapshot={snapshot} picture={picture} />;
}

function FanWalk({ ctx, snapshot, picture }: Pick<Props, "ctx" | "picture"> & { snapshot: DuctSnapshot & { sourceVersion?: string } }) {
  const { authored, value, sheet, roster, nameOf, issue, state, fanKey } = useSheetData(ctx, snapshot);
  const picked = authored.fan.kind === "all" ? "all" : authored.fan.ids;
  const jump = useRef<((key: SubjectKey) => void) | null>(null);
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf} jump={jump}>
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
