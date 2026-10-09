/**
 * PROCESS FACTS — the marks a running Revit is addressed and described by (machine control plane,
 * design-system ledger 2026-10-09). Both are `FactChip`s: machine-measured, so mono, and neither
 * is a control.
 *
 * - `PidChip` is the exact process id. An icon-started Revit has no session name, so the SDK
 *   addresses it by this number; the chip is the one place the number is drawn.
 * - `ShapeCells` is the SDK's `SessionShape`, one cell per axis, in the SDK's words. A cell is
 *   never coloured: the word that departs from a plain installed Revit ("checkout", "hot",
 *   "background", "quarantine") already says so.
 */
import type { SessionShape } from "@pe/host-contracts/pe-revit-contract";

import { FactChip } from "./chip";

export function PidChip({ pid, title }: { pid: number; title?: string }) {
  return (
    <FactChip title={title ?? "process id; the SDK addresses a Revit with no session name by it"}>
      pid {pid}
    </FactChip>
  );
}

type ShapeAxes = Pick<SessionShape, "payload" | "reload" | "posture" | "quarantine">;

/** One cell per shape axis. `axes` narrows to the ones the caller can state (a new Revit's
 * reload is the SDK's to decide, so the launcher omits it). */
export function ShapeCells({
  shape,
  axes = ["payload", "reload", "posture", "quarantine"],
}: {
  shape: Partial<ShapeAxes>;
  axes?: readonly (keyof ShapeAxes)[];
}) {
  const cells: Record<keyof ShapeAxes, [string, string] | null> = {
    payload: shape.payload
      ? [shape.payload, "payload: installed bytes, or a checkout's own build"]
      : null,
    reload: shape.reload
      ? [
          shape.reload === "hot" ? "hot" : "no reload",
          "reload: hot means pe-revit hr can apply new code into this Revit",
        ]
      : null,
    posture: shape.posture
      ? [shape.posture, "posture: a normal Revit window, or none brought forward"]
      : null,
    quarantine:
      shape.quarantine === undefined
        ? null
        : [
            shape.quarantine ? "quarantine" : "add-ins on",
            "add-ins: quarantine keeps third-party add-ins off for this Revit",
          ],
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {axes.map((axis) => {
        const cell = cells[axis];
        return cell ? (
          <FactChip key={axis} title={cell[1]}>
            {cell[0]}
          </FactChip>
        ) : null;
      })}
    </span>
  );
}
