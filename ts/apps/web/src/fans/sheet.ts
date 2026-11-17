import { z } from "zod";
import { DUCT_UNIT_ROLES, FAN_CELLS, routeAddress, subjectCode, type fansSheetData, type Immutable } from "@pe/agent-contracts";
import { local, parameter, store, type BindingDraw, type CellLayer, type Domain, type EnumChoice, type SheetSlot } from "@pe/agent-contracts/slots";
import { fanWriteCells } from "@pe/ducts-domain/staged";
import { suggestKind, suggestRole } from "@pe/ducts-domain/roster";
import { sheetSystems } from "@pe/ducts-domain/sheet/scoped-snapshot";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementSubject, workElementId } from "@pe/ducts-domain/work-subject";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import { ductsSettings, ENGINE_DEFAULT_NO_SHARED_ROOT, NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";

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
const idOf = (read: Read, row: string | undefined) => {
  const snapshot = snapshotOf(read);
  return snapshot && row != null ? workElementId(snapshot, row) : null;
};
const nameOf = (read: Read, row: string, word: string) => {
  const snapshot = snapshotOf(read), id = idOf(read, row);
  return snapshot && id != null ? `${elementLabeler(snapshot)(id)} · ${word}` : word;
};
const rowsOf = (read: Read, ids: readonly string[]) =>
  ids.flatMap((id) => { const s = subjectOf(snapshotOf(read), id); return s ? [s] : []; });

/**
 * A resolved input as a model layer under Work, in the cell's shape (`{ inWg }`, a plain cfm). The
 * source is the tier the host served: `project` or `firm` only when that home's file states the
 * value; a criterion no home states is `default`, and says so when the firm home was not found.
 */
const SOURCES: Readonly<Record<string, CellLayer["source"]>> = { Work: "work", "model-store": "model-store", project: "project", firm: "firm", default: "default" };
const layer = (resolved: { readonly value: unknown; readonly source: string; readonly units?: string | null; readonly ref?: string | null } | undefined, wrap: (v: unknown) => unknown, read?: Read): CellLayer | null => {
  if (!resolved || resolved.value == null) return null;
  const source = SOURCES[resolved.source] ?? "model";
  const firm = read?.sheetView.firm;
  // The evidence the resolver named rides with the value; only a refused firm home replaces it.
  return { value: wrap(resolved.value), source, ...(resolved.units ? { unit: resolved.units } : {}),
    ...(source === "default" && firm && "refused" in firm ? { ref: ENGINE_DEFAULT_NO_SHARED_ROOT } : resolved.ref ? { ref: resolved.ref } : {}) };
};

const units = (read: Read) => Object.keys(inputsOf(read)?.units ?? {});
const fanUnit = (read: Read) => read?.open?.overview.fan?.unitId ?? null;
/** The write scope offered from the open fan, with how many staged cells it writes; a standing scope on another fan stays listed. */
const scopeChoices = (read: Read): readonly EnumChoice[] => {
  const snapshot = snapshotOf(read);
  const fan = read?.open?.overview.fan, standing = read?.fansWork.writeIntent.edit?.value?.walk;
  const mine = (walk: { unitId: number; portIndex: number }) => !!fan && walk.unitId === fan.unitId && walk.portIndex === (fan as { portIndex?: number }).portIndex;
  return [
    ...(fan && "portIndex" in fan ? [{ label: `${fan.mark || `unit ${fan.unitId}`} · ${snapshot ? fanWriteCells(read!.fansWork, snapshot, read!.open?.overview.cohorts ?? []).length : 0} staged`, value: { walk: { unitId: fan.unitId, portIndex: fan.portIndex } },
      description: "Write this fan's walk and its staged cells" }] : []),
    ...(standing && !mine(standing) ? [{ label: `unit ${standing.unitId}`, value: { walk: standing }, description: "Another fan's scope, still standing" }] : []),
    { value: null, label: "None", description: "Clear the write scope" },
  ];
};
/**
 * One writable fan input as a sheet binding: its slot and domain come from the one inputs table
 * (`FAN_INPUTS`); only how many digits a unit draws is decided here.
 */
const DIGITS: Readonly<Record<string, number>> = { "in-wg": 4, cfm: 0 };
const drawn = (domain: Domain): Domain =>
  domain.kind === "number" && domain.unit && domain.unit in DIGITS ? { ...domain, digits: DIGITS[domain.unit] }
  : domain.kind === "object" ? { ...domain, fields: Object.fromEntries(Object.entries(domain.fields).map(([key, field]) => [key, drawn(field)])) }
  : domain;
const input = (row: { readonly parameter: string | null; readonly domain: Domain; readonly name: string }, draw: BindingDraw) => {
  if (!row.parameter) throw Error(`${row.name} is not a writable fan input`);
  return parameter(row.parameter, drawn(row.domain), draw);
};

export const fansSheet = {
  draft: true,
  // Every input reads the open fan's walk; with none open the sheet says where to open one.
  empty: (read: Read) => (read && !snapshotOf(read) ? "Open a fan from the roster." : null),
  // The design it depends on, read across routes: one line and a link that opens /ducts on it.
  from: (read: Read, search) => {
    if (read?.ductsRevision == null) return null;
    const firm = read.sheetView.firm;
    const snapshot = snapshotOf(read);
    const systems = snapshot ? sheetSystems(snapshot) : [];
    return {
      // Slice 2b: without a shared root the firm layer is refused and the design runs on the engine seed.
      says: `Priced with the /ducts design, Work r${read.ductsRevision}${!firm ? "" : "refused" in firm
        ? `: ${ENGINE_DEFAULT_NO_SHARED_ROOT}. ${NO_SHARED_ROOT}`
        : !firm.present ? " over defaults where no home states a value"
        : ` over firm ${firm.version} · ${firm.path.split(/[\\/]/).at(-1)}`}`,
      href: routeAddress("ducts").link(systems.length ? {
        system: { kind: "ids", ids: systems.map(name => subjectCode({ keyKind: "system-name", key: name })) },
      } : {}, Object.fromEntries(["target", "fixture", "thread"].flatMap(key => typeof search[key] === "string" ? [[key, search[key]]] : []))),
    };
  },
  bindings: {
    // The design criteria this fan prices under, each with the home tier that served it; "save at" writes that home.
    // Design friction stays /ducts design data (ducts ledger Q2a), so Fans omits it.
    ...Object.fromEntries(Object.entries(ductsSettings).filter(([key]) => key !== "setting.ducts.designFriction")),
    writeIntent: local({ kind: "enum", shape: z.strictObject({ walk: z.strictObject({ unitId: z.number().int().positive(), portIndex: z.number().int().nonnegative() }) }), choices: scopeChoices }, "route", { label: "Write scope" }),
    roles: store("_PE_DuctLosses", { kind: "object", fields: { role: { kind: "enum", shape: z.enum(DUCT_UNIT_ROLES), choices: DUCT_UNIT_ROLES.map(role => ({ value: role, label: role === "fan" ? "Fan" : "Passive" })) } } }, "subject", {
      rows: (read: Read) => rowsOf(read, (snapshotOf(read)?.nodes ?? []).filter((n) => n.kind === "equipment").map((n) => String(n.id))),
      rowLabel: (read, row) => nameOf(read, row, "Unit role"),
      model: (read: Read, row) => {
        const id = idOf(read, row), resolved = id == null ? undefined : inputsOf(read)?.units[String(id)]?.role;
        if (resolved?.value != null) return layer(resolved, (role) => ({ role }));
        const node = snapshotOf(read)?.nodes.find((n) => n.id === id);
        return node ? { value: { role: suggestRole(node, suggestKind(node).kind) }, source: "default" } : null;
      },
    }),
    equipmentFlows: input(FAN_CELLS.equipmentFlows, {
      rows: (read: Read) => rowsOf(read, units(read)),
      rowLabel: (read, row) => nameOf(read, row, "Unit airflow"),
      model: (read: Read, row) => {
        const id = idOf(read, row), node = snapshotOf(read)?.nodes.find((n) => n.id === id);
        const conflict = id === fanUnit(read) ? read?.open?.inputs?.notes.find((n) => n.kind === "flow-conflict")?.text : undefined;
        const base = layer(inputsOf(read)?.units[String(id)]?.cfm, (v) => v) ?? { value: null };
        return {
          ...base,
          ...(conflict ? { note: conflict.replace(/^fan \d+: /, "Conflict: ") } : {}),
          ...(node && node.flowParameter === null ? { refusal: `${[node.type, node.family].filter(Boolean).join(" / ") || "This fan"} has no ${snapshotOf(read)?.slots.fanFlow ?? "selected airflow"} parameter; add it to the family or map flow to an existing parameter` } : {}),
        };
      },
    }),
    // The ESP written to the fan (required). The open fan's own is an input of this sheet; another unit's only once Work stages it.
    esp: input(FAN_CELLS.esp, {
      rows: (read: Read) => rowsOf(read, units(read)).filter((key) =>
        key === subjectOf(snapshotOf(read), fanUnit(read) ?? -1) || read?.fansWork.esp[key]?.edit != null),
      rowLabel: (read, row) => nameOf(read, row, "Unit ESP"),
      // Only the open fan's staged value is resolved by this read; another unit's row shows its Work cell alone.
      model: (read: Read, row) => idOf(read, row) === fanUnit(read) ? layer(read?.open?.overview.espValues?.staged, (v) => ({ inWg: v })) : null,
    }),
    // The ESP a fan is rated for: stated here or by Pea and kept in Work, since no parameter holds it (P-030).
    ratedEsp: local(drawn(FAN_CELLS.ratedEsp.domain), "subject", {
      rows: (read: Read) => rowsOf(read, units(read)),
      rowLabel: (read, row) => nameOf(read, row, "Unit rated ESP"),
      model: (read: Read, row) => layer(inputsOf(read)?.units[String(idOf(read, row))]?.esp, (v) => ({ inWg: v })),
    }),
    flows: input(FAN_CELLS.flows, {
      rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.terminals ?? {})),
      rowLabel: (read, row) => nameOf(read, row, "Terminal airflow"),
      model: (read: Read, row) => layer(inputsOf(read)?.terminals[String(idOf(read, row))]?.cfm, (v) => v),
    }),
    terminalDrops: input(FAN_CELLS.terminalDrops, {
      rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.terminals ?? {})),
      rowLabel: (read, row) => nameOf(read, row, "Terminal drop"),
      model: (read: Read, row) => layer(inputsOf(read)?.terminals[String(idOf(read, row))]?.drop, (v) => ({ inWg: v }), read),
    }),
    componentDrops: input(FAN_CELLS.componentDrops, {
      rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.components ?? {})),
      rowLabel: (read, row) => nameOf(read, row, "Part drop"),
      model: (read: Read, row) => layer(inputsOf(read)?.components[String(idOf(read, row))]?.drop, (v) => ({ inWg: v })),
    }),
  },
} as const satisfies SheetSlot;
