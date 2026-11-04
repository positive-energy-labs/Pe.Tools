import { TooltipHint } from "@pe/kit/lang/tooltip";
import { useContext } from "react";
import { cellFocusOf } from "../../cell-focus";
/**
 * The inputs that live on the system tree: a terminal's flow and drop, a unit's flow, ESP and role.
 * Each is one kit trichotomy `StateCell` over its Work cell: a person's edit stages, Pea's suggestion
 * shows as the proposed state with accept and reject, and the value drawn is the one Pe resolved
 * (its rung named beside it in quiet text) until one is edit.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import { storedRuling } from "@pe/ducts-domain/rulings";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { cellFromDraft,StateCell } from "@pe/kit/lang/cell";
import { DuctsOwner } from "../../pane-context";

import { equipmentInputs,terminalInputs,type Resolved } from "../../inputs";
import type { LossesWork } from "../../work";
import { PressureEquivalent } from "./pressure-equivalent";

type Rung = import("@pe/agent-contracts").DuctFlow | import("@pe/agent-contracts").DuctDrop;

interface CellSpec {
  segment: "flows" | "equipmentFlows" | "terminalDrops" | "esp";
  /** The unit drawn inside the box, and the shorter form a narrow pane shows. */
  unit: { label: string; short?: string };
  digits: number;
  /** The text a rung's value draws as. */
  text: (value: Rung | undefined) => string | undefined;
  /** The rung a typed number stages, keeping what the standing rung carries (a stated source). */
  rung: (typed: string, standing: Rung | undefined) => Rung;
}

const SPECS = {
  flows: {
    segment: "flows",
    unit: { label: "cfm" },
    digits: 0,
    text: (v) => (v && "cfm" in v ? String(v.cfm) : undefined),
    rung: (typed, standing) => ({
      cfm: Number(typed),
      ...(standing?.source ? { source: standing.source } : {}),
    }),
  },
  equipmentFlows: {
    segment: "equipmentFlows",
    unit: { label: "cfm" },
    digits: 0,
    text: (v) => (v && "cfm" in v ? String(v.cfm) : undefined),
    rung: (typed, standing) => ({
      cfm: Number(typed),
      ...(standing?.source ? { source: standing.source } : {}),
    }),
  },
  terminalDrops: {
    segment: "terminalDrops",
    unit: { label: "in-wg", short: "wg" },
    digits: 4,
    text: (v) => (v && "inWg" in v ? String(v.inWg) : undefined),
    rung: (typed, standing) => ({
      inWg: Number(typed),
      ...(standing?.source ? { source: standing.source } : {}),
    }),
  },
  esp: {
    segment: "esp",
    unit: { label: "in-wg", short: "wg" },
    digits: 4,
    text: (v) => (v && "inWg" in v ? String(v.inWg) : undefined),
    rung: (typed) => ({ inWg: Number(typed) }),
  },
} satisfies Record<string, CellSpec>;

/** A segment's cell key and the quiet rung word: edit, Pea's suggestion, or the resolved rung's. */
function InputCell({
  spec,
  id,
  work,
  resolved,
  label,
  damage,
}: {
  spec: CellSpec;
  id: number;
  work: LossesWork;
  resolved: Resolved<number>;
  label: string;
  damage?: string;
}) {
  const key = String(id);
  const landing = cellFocusOf(useContext(DuctsOwner)?.selected ?? "");
  const cell = work.doc?.[spec.segment][key] ?? {};
  const standing = (cell.edit ?? cell.suggestion)?.value;
  const word = cell.edit ? "override" : cell.suggestion ? "Pea proposes" : resolved.word;
  const value = spec.text(standing) ?? (resolved.value == null ? "" : String(resolved.value));
  return (
    <span
      className="dl-cells-item"
      data-e-cell={`${spec.segment}:${id}`}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      <StateCell
        {...cellFromDraft<Rung>(
          cell,
          {
            value,
            cap: "locked", capReason: "Fan inputs are unavailable",
          },
          (value) => spec.text(value) ?? "",
        )}
        scale="row"
        land={
          landing?.pane === "inputs" && landing.segment === spec.segment && landing.id === id
            ? landing.key
            : undefined
        }
        damage={damage}
        unit={spec.unit}
        numeric={{ min: 0, digits: spec.digits }}
        transitions={[]}
      />
      {spec.unit.label === "in-wg" && value !== "" ? (
        <PressureEquivalent inWg={Number(value)} />
      ) : null}
      <span className="dl-cells-note t-small" data-e-source={word ?? ""}>
        {word}
      </span>
    </span>
  );
}

/**
 * A unit's role: proposed from its design flow (`unit-roles.ts`, the reason beside it) until a
 * person rules `fan` or `passive`; typing either word stages it, and a ruling the model's store
 * holds reads as "ruled" (`rulingPatches`).
 */
function RoleCell({
  id,
  work,
  resolved,
  store,
}: {
  id: number;
  work: LossesWork;
  resolved: Resolved<"fan" | "passive"> & { reason?: string };
  store: DuctSnapshot["store"];
}) {
  const key = String(id);
  const landing = cellFocusOf(useContext(DuctsOwner)?.selected ?? "");
  const cell = work.doc?.roles[key] ?? {};
  const standing = (cell.edit ?? cell.suggestion)?.value;
  const stored = storedRuling(store, "roles", key);
  const word =
    cell.edit && stored === cell.edit.value.role
      ? "ruled"
      : cell.edit
        ? "override"
        : cell.suggestion
          ? "Pea proposes"
          : resolved.word;
  return (
    <span
      className="dl-cells-item"
      data-e-cell={`roles:${id}`}
      aria-label={`role of ${id}`}
      onClick={(event) => event.stopPropagation()}
    >
      <StateCell
        {...cellFromDraft(
          cell,
          { value: standing?.role ?? resolved.value ?? "fan", cap: "locked", capReason: "Fan inputs are unavailable" },
          (value) => value?.role ?? "",
        )}
        scale="row"
        land={
          landing?.pane === "inputs" && landing.segment === "roles" && landing.id === id
            ? landing.key
            : undefined
        }
        placeholder="fan"
        transitions={[]}
      />
      <TooltipHint content={resolved.reason}>
        <span className="dl-cells-note t-small" data-e-source={word ?? ""}>
          role{word ? ` · ${word}` : ""}
          {!cell.edit && !cell.suggestion && resolved.reason ? ` (${resolved.reason})` : ""}
        </span>
      </TooltipHint>
    </span>
  );
}

/** What a tree row's cells read: the Work to stage into and the priced result that resolves each rung. */
export interface InputsCtx {
  snapshot: DuctSnapshot;
  priced: Priced | null;
  work: LossesWork;
  /** The open system's groups: a unit's flow is the one they price it at (`unitFlowIn`); null, the document's. */
  groups?: readonly string[] | null;
}

/** A terminal row's flow and drop cells. */
export function TerminalCells({ ctx, id }: { ctx: InputsCtx; id: number }) {
  if (!ctx.priced) return null;
  const from = ctx.snapshot.nodes.find((n) => n.id === id)?.flowParameter ?? null;
  const inputs = terminalInputs(ctx.priced, id, from);
  return (
    <span className="dl-cells">
      <InputCell
        spec={SPECS.flows}
        id={id}
        work={ctx.work}
        damage={inputs.flow.value == null ? "no airflow" : undefined}
        resolved={inputs.flow}
        label={`flow of ${id}`}
      />
      <InputCell
        spec={SPECS.terminalDrops}
        id={id}
        work={ctx.work}
        resolved={inputs.drop}
        label={`drop of ${id}`}
      />
    </span>
  );
}

/** An air mover row's flow, role and ESP cells. */
export function EquipmentCells({ ctx, id }: { ctx: InputsCtx; id: number }) {
  if (!ctx.priced) return null;
  const inputs = equipmentInputs(ctx.snapshot, ctx.priced, id, ctx.groups ?? null);
  return (
    <span className="dl-cells">
      <InputCell
        spec={SPECS.equipmentFlows}
        id={id}
        work={ctx.work}
        resolved={inputs.flow}
        label={`flow of ${id}`}
      />
      <RoleCell id={id} work={ctx.work} resolved={inputs.role} store={ctx.snapshot.store} />
      <InputCell
        spec={SPECS.esp}
        id={id}
        work={ctx.work}
        resolved={inputs.esp}
        label={`ESP of ${id}`}
      />
    </span>
  );
}
