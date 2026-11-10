import { z } from "zod";
import { DUCT_PARAMETER_KEYS, DUCT_UNIT_ROLES, type fansSheetData, type Immutable, type Resolved } from "@pe/agent-contracts";
import { local, parameter, store, type CellLayer, type SheetChoice, type SheetSlot } from "@pe/agent-contracts/slots";
import { airflowOptions } from "@pe/ducts-domain/airflow";
import { fanWriteCells } from "@pe/ducts-domain/staged";
import { suggestKind, suggestRole } from "@pe/ducts-domain/roster";
import { sheetSystems } from "@pe/ducts-domain/sheet/scoped-snapshot";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementSubject, workElementId } from "@pe/ducts-domain/work-subject";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import { ductsLink } from "../ducts/identity.ts";

/*
 * /fans' sheet (ruling 2026-11-10: /fans keeps Fans Work only). Every binding stages Fans Work; the
 * /ducts design it prices with is the read-only `from` line, linked to /ducts. Rows, model values and
 * options come from the Fans core read (`fans.sheet`): the resolved inputs of the open fan's walk.
 */
type Read = Immutable<z.output<typeof fansSheetData>> | null | undefined;
type Snapshot = DuctSnapshot & { sourceVersion?: string };

const snapshotOf = (read: Read): Snapshot | null => {
  const s = read?.sheetSnapshot as unknown as Snapshot | { kind: "absent" } | undefined;
  return s && !("kind" in s) ? s : null;
};
const inputsOf = (read: Read) => read?.sheetView.inputs ?? null;
/** The Work key of an element on the walk (its UniqueId SubjectRef), or null off the snapshot. */
const subjectOf = (snapshot: Snapshot | null, id: string | number) => {
  const element = snapshot && [...snapshot.nodes, ...snapshot.segments].find((e) => e.id === Number(id));
  return element ? elementSubject(element) : null;
};
const idOf = (read: Read, row: string) => {
  const snapshot = snapshotOf(read);
  return snapshot ? workElementId(snapshot, row) : null;
};
const nameOf = (read: Read, row: string, word: string) => {
  const snapshot = snapshotOf(read), id = idOf(read, row);
  return snapshot && id != null ? `${elementLabeler(snapshot)(id)} · ${word}` : word;
};
const rowsOf = (read: Read, ids: readonly string[]) =>
  ids.flatMap((id) => { const s = subjectOf(snapshotOf(read), id); return s ? [s] : []; });

/** A resolved input as a model layer under Work, in the cell's shape (`{ inWg }`, `{ cfm }`). */
const SOURCES: Readonly<Record<string, CellLayer["source"]>> = { "model-store": "model-store", firm: "firm", default: "default" };
const layer = (resolved: Immutable<Resolved<unknown>> | undefined, wrap: (v: unknown) => unknown): CellLayer | null =>
  resolved && resolved.value != null
    ? { value: wrap(resolved.value), source: SOURCES[resolved.source] ?? "model", ...(resolved.units ? { unit: resolved.units } : {}) }
    : null;

const units = (read: Read) => Object.keys(inputsOf(read)?.units ?? {});
const fanUnit = (read: Read) => read?.open?.overview.fan?.unitId ?? null;
const SLOT_WORDS: Readonly<Record<(typeof DUCT_PARAMETER_KEYS)[number], string>> = {
  fanStatic: "Unit ESP slot", fanFlow: "Fan flow slot", componentDrop: "Component drop slot",
  terminalDrop: "Grille drop slot", fittingCoefficient: "Fitting coefficient slot", terminalFlow: "Airflow slot",
};
const slotChoices = (read: Read, row: string | undefined): readonly SheetChoice[] => {
  const snapshot = snapshotOf(read);
  if (row === "fanStatic") {
    const offered = read?.espOptions;
    const options = (offered?.items ?? []).flatMap((item) => item.metadata?.name ? [{
      key: item.value, label: item.label, value: item.metadata.name,
      description: [item.metadata.kind, item.metadata.storageType, item.metadata.dataTypeId].filter(Boolean).join(" · "),
    }] : []);
    // Absent or failed options never let a stale name stage: one disabled option says why.
    const refusal = read?.espOptionsError ?? (!offered ? "Read unit parameter options"
      : offered.result.kind !== "Success" ? offered.result.message : !options.length ? "No numeric parameters on these units" : null);
    return refusal ? [{ key: "unread", label: refusal, disabled: refusal }] : options;
  }
  if (row === "terminalFlow")
    return (read?.fans.slots ?? []).map((s) => ({ key: s.slot, label: s.slot, value: s.slot, description: `${s.covered} of ${s.total} terminals in the document carry it` }));
  if (row === "fanFlow" && snapshot)
    return airflowOptions(snapshot, null, "unit").options.map((o) => ({ key: o.slot, label: o.label, value: o.slot, description: `${o.have} of ${o.of} units on this fan's walk carry it` }));
  return [];
};
/** The write scope offered from the open fan, with how many staged cells it writes; a standing scope on another fan stays listed. */
const scopeChoices = (read: Read): readonly SheetChoice[] => {
  const snapshot = snapshotOf(read);
  const fan = read?.open?.overview.fan, standing = read?.fansWork.writeIntent.edit?.value?.walk;
  const mine = (walk: { unitId: number; portIndex: number }) => !!fan && walk.unitId === fan.unitId && walk.portIndex === (fan as { portIndex?: number }).portIndex;
  return [
    ...(fan && "portIndex" in fan ? [{ key: "fan", label: `${fan.mark || `unit ${fan.unitId}`} · ${snapshot ? fanWriteCells(read!.fansWork, snapshot).length : 0} staged`, value: { walk: { unitId: fan.unitId, portIndex: fan.portIndex } },
      description: "Write this fan's walk and its staged cells" }] : []),
    ...(standing && !mine(standing) ? [{ key: "other", label: `unit ${standing.unitId}`, value: { walk: standing }, description: "Another fan's scope, still standing" }] : []),
    { key: "none", label: "None", clear: true, description: "Clear the write scope" },
  ];
};
const inWg = z.strictObject({ inWg: z.number().nonnegative() });
const cfm = z.strictObject({ cfm: z.number().nonnegative() });

export const fansSheet = {
  draft: true,
  // Every input reads the open fan's walk; with none open the sheet says where to open one.
  empty: (read: Read) => (read && !snapshotOf(read) ? "Open a fan from the roster." : null),
  // The design it depends on, read across routes: one line and a link that opens /ducts on it.
  from: (read: Read, search) => {
    if (read?.ductsRevision == null) return null;
    const firm = read.sheetView.firm;
    const snapshot = snapshotOf(read);
    return {
      says: `Priced with the /ducts design, Work r${read.ductsRevision}${firm ? ` over firm ${firm.version} · ${firm.path.split(/[\\/]/).at(-1)}` : ""}`,
      href: ductsLink(snapshot ? sheetSystems(snapshot) : [], search),
    };
  },
  bindings: {
    writeIntent: local(z.unknown(), "route", { label: "Write scope", choices: scopeChoices }),
    // Slot names are Pe-side configuration (which Revit parameter each slot reads and writes), never a Revit value: `local`.
    parameters: local(z.string().min(1), "subject", {
      rows: () => DUCT_PARAMETER_KEYS,
      rowLabel: (_read, row) => SLOT_WORDS[row as keyof typeof SLOT_WORDS] ?? row,
      model: (read: Read, row) => {
        const slot = snapshotOf(read)?.slots[row as keyof Snapshot["slots"]];
        return slot ? { value: slot } : null;
      },
      choices: slotChoices,
    }),
    roles: store("_PE_DuctLosses", z.strictObject({ role: z.enum(DUCT_UNIT_ROLES) }), "subject", {
      rows: (read: Read) => rowsOf(read, (snapshotOf(read)?.nodes ?? []).filter((n) => n.kind === "equipment").map((n) => String(n.id))),
      rowLabel: (read, row) => nameOf(read, row, "Unit role"),
      model: (read: Read, row) => {
        const id = idOf(read, row!), resolved = id == null ? undefined : inputsOf(read)?.units[String(id)]?.role;
        if (resolved?.value != null) return layer(resolved, (role) => ({ role }));
        const node = snapshotOf(read)?.nodes.find((n) => n.id === id);
        return node ? { value: { role: suggestRole(node, suggestKind(node).kind) }, source: "default" } : null;
      },
      choices: () => DUCT_UNIT_ROLES.map((role) => ({ key: role, label: role === "fan" ? "Fan" : "Passive", value: { role } })),
    }),
    equipmentFlows: parameter("fanFlow", cfm, undefined, {
      field: "cfm", unit: "cfm", min: 0, digits: 0,
      rows: (read: Read) => rowsOf(read, units(read)),
      rowLabel: (read, row) => nameOf(read, row, "Unit airflow"),
      model: (read: Read, row) => {
        const id = idOf(read, row!), node = snapshotOf(read)?.nodes.find((n) => n.id === id);
        const conflict = id === fanUnit(read) ? read?.open?.inputs?.notes.find((n) => n.kind === "flow-conflict")?.text : undefined;
        const base = layer(inputsOf(read)?.units[String(id)]?.cfm, (v) => ({ cfm: v })) ?? { value: null };
        return {
          ...base,
          ...(conflict ? { note: conflict.replace(/^fan \d+: /, "Conflict: ") } : {}),
          ...(node && node.flowParameter === null ? { refusal: `${[node.type, node.family].filter(Boolean).join(" / ") || "This fan"} has no ${snapshotOf(read)?.slots.fanFlow ?? "selected airflow"} parameter; add it to the family or map flow to an existing parameter` } : {}),
        };
      },
    }),
    // The open fan's own ESP is an input of this sheet; another unit's only once Work stages it.
    esp: parameter("fanStatic", inWg, undefined, {
      field: "inWg", unit: "in-wg", min: 0, digits: 4,
      rows: (read: Read) => rowsOf(read, units(read).filter((id) =>
        Number(id) === fanUnit(read) || inputsOf(read)?.units[id]?.esp.source === "Work")),
      rowLabel: (read, row) => nameOf(read, row, "Unit ESP"),
      model: (read: Read, row) => layer(inputsOf(read)?.units[String(idOf(read, row!))]?.esp, (v) => ({ inWg: v })),
    }),
    flows: parameter("terminalFlow", cfm, undefined, {
      field: "cfm", unit: "cfm", min: 0, digits: 0,
      rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.terminals ?? {})),
      rowLabel: (read, row) => nameOf(read, row, "Terminal airflow"),
      model: (read: Read, row) => layer(inputsOf(read)?.terminals[String(idOf(read, row!))]?.cfm, (v) => ({ cfm: v })),
    }),
    terminalDrops: parameter("terminalDrop", inWg, undefined, {
      field: "inWg", unit: "in-wg", min: 0, digits: 4,
      rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.terminals ?? {})),
      rowLabel: (read, row) => nameOf(read, row, "Terminal drop"),
      model: (read: Read, row) => layer(inputsOf(read)?.terminals[String(idOf(read, row!))]?.drop, (v) => ({ inWg: v })),
    }),
    componentDrops: parameter("componentDrop", inWg, undefined, {
      field: "inWg", unit: "in-wg", min: 0, digits: 4,
      rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.components ?? {})),
      rowLabel: (read, row) => nameOf(read, row, "Part drop"),
      model: (read: Read, row) => layer(inputsOf(read)?.components[String(idOf(read, row!))]?.drop, (v) => ({ inWg: v })),
    }),
  },
} as const satisfies SheetSlot;
