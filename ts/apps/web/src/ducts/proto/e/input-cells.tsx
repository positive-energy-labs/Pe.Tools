/**
 * The inputs that live on the system tree: a terminal's flow and drop, a unit's flow, ESP and role.
 * Each is one kit trichotomy `StateCell` over its Work cell: a person's edit stages, Pea's proposal
 * shows as the proposed state with accept and reject, and the value drawn is the one Pe resolved
 * (its rung named beside it in quiet text) until one is staged.
 */
import { DUCT_UNIT_ROLES, transitionPatches } from "@pe/agent-contracts";
import { storedRuling } from "@pe/ducts-domain/rulings";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { reviewTransitions, type CellWire } from "#/components/work/band";

import { rulingPatches } from "../../assumptions";
import { equipmentInputs, terminalInputs, type Resolved } from "../../inputs";
import type { CellSegment } from "../../inbox-rows";
import type { LossesWork } from "../../work";

type Rung = Record<string, unknown>;

interface CellSpec {
  segment: CellSegment;
  /** The unit word after the value. */
  unit: string;
  digits: number;
  placeholder: string;
  /** The text a rung's value draws as. */
  text: (value: Rung | undefined) => string | undefined;
  /** The rung a typed number stages, keeping what the standing rung carries (a stated source). */
  rung: (typed: string, standing: Rung | undefined) => Rung;
}

const SPECS = {
  flows: {
    segment: "flows",
    unit: "cfm",
    digits: 0,
    placeholder: "cfm",
    text: (v) => (v?.cfm == null ? undefined : String(v.cfm)),
    rung: (typed, standing) => ({
      cfm: Number(typed),
      ...(standing?.source ? { source: standing.source } : {}),
    }),
  },
  equipmentFlows: {
    segment: "equipmentFlows",
    unit: "cfm",
    digits: 0,
    placeholder: "cfm",
    text: (v) => (v?.cfm == null ? undefined : String(v.cfm)),
    rung: (typed, standing) => ({
      cfm: Number(typed),
      ...(standing?.source ? { source: standing.source } : {}),
    }),
  },
  terminalDrops: {
    segment: "terminalDrops",
    unit: "in-wg",
    digits: 4,
    placeholder: "drop",
    text: (v) => (v?.inWg == null ? undefined : String(v.inWg)),
    rung: (typed, standing) => ({
      inWg: Number(typed),
      ...(standing?.source ? { source: standing.source } : {}),
    }),
  },
  esp: {
    segment: "esp",
    unit: "in-wg",
    digits: 4,
    placeholder: "ESP",
    text: (v) => (v?.inWg == null ? undefined : String(v.inWg)),
    rung: (typed) => ({ inWg: Number(typed) }),
  },
} satisfies Record<string, CellSpec>;

/** A segment's cell key and the quiet rung word: staged, Pea's proposal, or the resolved rung's. */
function InputCell({
  spec,
  id,
  work,
  resolved,
  label,
}: {
  spec: CellSpec;
  id: number;
  work: LossesWork;
  resolved: Resolved<number>;
  label: string;
}) {
  const key = String(id);
  const cell = work.doc?.[spec.segment][key] ?? {};
  const standing = (cell.staged ?? cell.proposal)?.value as Rung | undefined;
  const wire: CellWire = { segment: spec.segment, revision: work.revision, write: work.write };
  const word = cell.staged ? "override" : cell.proposal ? "Pea proposes" : resolved.word;
  return (
    <span
      className="inline-flex items-baseline gap-1 whitespace-nowrap"
      data-e-cell={`${spec.segment}:${id}`}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      <StateCell
        {...cellFromTrichotomy(
          cell,
          {
            value: spec.text(standing) ?? (resolved.value == null ? "" : String(resolved.value)),
            cap: "editable",
          },
          (value) => spec.text(value as Rung) ?? "",
        )}
        scale="row"
        numeric={{ min: 0, digits: spec.digits }}
        placeholder={spec.placeholder}
        onCommit={(text: string) =>
          work
            .write(
              transitionPatches([spec.segment], key, cell, {
                kind: "stage",
                rung: { value: spec.rung(text, standing) },
              }),
            )
            .then((refusal) => refusal?.message)
        }
        transitions={reviewTransitions(wire, key, cell)}
      />
      <span className="t-small text-ink-2" data-e-source={word ?? ""}>
        {spec.unit}
        {word ? ` · ${word}` : ""}
      </span>
    </span>
  );
}

/**
 * A unit's role: `fan` unless a person rules `passive`; typing either word stages it. A `passive`
 * the model's store holds reads as "ruled"; typing `fan` takes it back (`rulingPatches`).
 */
function RoleCell({
  id,
  work,
  resolved,
  store,
}: {
  id: number;
  work: LossesWork;
  resolved: Resolved<"fan" | "passive">;
  store: DuctSnapshot["store"];
}) {
  const key = String(id);
  const cell = work.doc?.roles[key] ?? {};
  const standing = (cell.staged ?? cell.proposal)?.value;
  const wire: CellWire = { segment: "roles", revision: work.revision, write: work.write };
  const stored = storedRuling(store, "roles", key);
  const word =
    cell.staged && stored === cell.staged.value.role
      ? "ruled"
      : cell.staged
        ? "override"
        : cell.proposal
          ? "Pea proposes"
          : resolved.word;
  return (
    <span
      className="inline-flex items-baseline gap-1 whitespace-nowrap"
      data-e-cell={`roles:${id}`}
      aria-label={`role of ${id}`}
      onClick={(event) => event.stopPropagation()}
    >
      <StateCell
        {...cellFromTrichotomy(
          cell,
          { value: standing?.role ?? resolved.value ?? "fan", cap: "editable" },
          (value) => (value as { role?: string } | undefined)?.role ?? "",
        )}
        scale="row"
        placeholder="fan"
        onCommit={(text: string) => {
          const role = text.trim().toLowerCase();
          if (!(DUCT_UNIT_ROLES as readonly string[]).includes(role))
            return `a role is ${DUCT_UNIT_ROLES.join(" or ")}`;
          return work
            .write(rulingPatches(work.doc, store, "roles", key, role) as never)
            .then((refusal) => refusal?.message);
        }}
        transitions={reviewTransitions(wire, key, cell)}
      />
      <span className="t-small text-ink-2" data-e-source={word ?? ""}>
        role{word ? ` · ${word}` : ""}
      </span>
    </span>
  );
}

/** What a tree row's cells read: the Work to stage into and the priced result that resolves each rung. */
export interface InputsCtx {
  snapshot: DuctSnapshot;
  priced: Priced | null;
  work: LossesWork;
}

/** A terminal row's flow and drop cells. */
export function TerminalCells({ ctx, id }: { ctx: InputsCtx; id: number }) {
  if (!ctx.priced) return null;
  const from = ctx.snapshot.nodes.find((n) => n.id === id)?.flowParameter ?? null;
  const inputs = terminalInputs(ctx.priced, id, from);
  return (
    <span className="inline-flex items-baseline gap-3">
      <InputCell
        spec={SPECS.flows}
        id={id}
        work={ctx.work}
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
  const inputs = equipmentInputs(ctx.snapshot, ctx.priced, id);
  return (
    <span className="inline-flex items-baseline gap-3">
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
