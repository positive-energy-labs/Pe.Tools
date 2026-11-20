import { z } from "zod";
import { DUCTS_CRITERIA_CELLS } from "@pe/ducts-contract/duct-inputs";
import { slotLayer } from "@pe/ducts-contract/system-work";
import { product } from "@pe/fans-contract/product";
import { sheetCells } from "@pe/agent-contracts/product";
import { routeAddress, subjectCode, type Immutable } from "@pe/agent-contracts";
import { type fansCalcData } from "@pe/fans-contract/fans-read";
import {
  cellSource,
  type BindingDraw,
  type CellLayer,
  type EnumChoice,
  type SheetSlot,
  type SheetBinding,
} from "@pe/agent-contracts/slots";
import type { ValueSource } from "@pe/agent-contracts/work-value";
import { fanWriteCells } from "@pe/ducts-domain/staged";
import { suggestKind, suggestRole } from "@pe/ducts-domain/roster";
import { receiptDrift } from "@pe/ducts-domain/calc/inputs";
import { calcSystems } from "@pe/ducts-domain/calc/scoped-snapshot";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementSubject, workElementId } from "@pe/ducts-domain/work-subject";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import { NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";
import { ductsSettings, ENGINE_DEFAULT_NO_SHARED_ROOT } from "@pe/ducts-contract/product";

/*
 * /fans' sheet (ruling 2026-11-10: /fans keeps Fans Work only). Every binding stages Fans Work; the
 * /ducts design it prices with is the read-only `from` line, linked to /ducts. Rows, model values and
 * options come from the Fans core read (`fans.calc`): the resolved inputs of the open fan's walk.
 */
type Read = Immutable<z.output<typeof fansCalcData>> | null | undefined;
type Snapshot = DuctSnapshot & { sourceVersion?: string };

const snapshotOf = (read: Read): Snapshot | null => {
  const s = read?.calcSnapshot as unknown as Snapshot | { kind: "absent" } | undefined;
  return s && !("kind" in s) ? s : null;
};
const inputsOf = (read: Read) => read?.calcView.inputs ?? null;
/** The Work key of an element on the walk (its UniqueId SubjectRef), or null off the snapshot. */
const subjectOf = (snapshot: Snapshot | null, id: string | number) => {
  const element =
    snapshot && [...snapshot.nodes, ...snapshot.segments].find((e) => e.id === Number(id));
  return element ? elementSubject(element) : null;
};
const idOf = (read: Read, row: string | undefined) => {
  const snapshot = snapshotOf(read);
  return snapshot && row != null ? workElementId(snapshot, row) : null;
};
const nameOf = (read: Read, row: string, word: string) => {
  const snapshot = snapshotOf(read),
    id = idOf(read, row);
  return snapshot && id != null ? `${elementLabeler(snapshot)(id)} · ${word}` : word;
};
const rowsOf = (read: Read, ids: readonly string[]) =>
  ids.flatMap((id) => {
    const s = subjectOf(snapshotOf(read), id);
    return s ? [s] : [];
  });

/**
 * A resolved input as a model layer under Work, in the cell's shape (`{ inWg }`, a plain cfm). The
 * source is the tier the host served: `project` or `firm` only when that home's file states the
 * value; a criterion no home states is `default`, and says so when the firm home was not found.
 */
const layer = (
  resolved:
    | {
        readonly value: unknown;
        readonly source: ValueSource | "none";
        readonly units?: string | null;
        readonly ref?: string | null;
      }
    | undefined,
  wrap: (v: unknown) => unknown,
  read?: Read,
): CellLayer | null => {
  if (!resolved || resolved.value == null || resolved.source === "none") return null;
  const source = cellSource(resolved.source);
  const firm = read?.calcView.firm;
  // The evidence the resolver named rides with the value; only a refused firm home replaces it.
  return {
    value: wrap(resolved.value),
    source,
    ...(resolved.units ? { unit: resolved.units } : {}),
    ...(source === "default" && firm && "refused" in firm
      ? { ref: ENGINE_DEFAULT_NO_SHARED_ROOT }
      : resolved.ref
        ? { ref: resolved.ref }
        : {}),
  };
};

/** A design value's model layer with its drift: what Revit holds now, and `drift` with a note where that is not what Pe last wrote. */
const live = (
  read: Read,
  segment: Parameters<typeof receiptDrift>[1],
  row: string | undefined,
  resolved: Parameters<typeof layer>[0],
  wrap: (v: unknown) => unknown,
): CellLayer | null => {
  const snapshot = snapshotOf(read),
    id = idOf(read, row),
    base = layer(resolved, wrap, read);
  const note = snapshot && id != null ? receiptDrift(snapshot, segment, id) : null;
  return note ? { ...(base ?? { value: null }), note, drift: true } : base;
};

const units = (read: Read) => Object.keys(inputsOf(read)?.units ?? {});
const fanUnit = (read: Read) => read?.open?.overview.fan?.unitId ?? null;
/** The write scope offered from the open fan, with how many staged cells it writes; a standing scope on another fan stays listed. */
const scopeChoices = (read: Read): readonly EnumChoice[] => {
  const snapshot = snapshotOf(read);
  const fan = read?.open?.overview.fan,
    standing = read?.fansWork.writeIntent.edit?.value?.walk;
  const mine = (walk: { unitId: number; portIndex: number }) =>
    !!fan &&
    walk.unitId === fan.unitId &&
    walk.portIndex === (fan as { portIndex?: number }).portIndex;
  return [
    ...(fan && "portIndex" in fan
      ? [
          {
            label: `${fan.mark || `unit ${fan.unitId}`} · ${snapshot ? fanWriteCells(read!.fansWork, snapshot).length : 0} staged`,
            value: { walk: { unitId: fan.unitId, portIndex: fan.portIndex } },
            description: "Write this fan's walk and its staged cells",
          },
        ]
      : []),
    ...(standing && !mine(standing)
      ? [
          {
            label: `unit ${standing.unitId}`,
            value: { walk: standing },
            description: "Another fan's scope, still standing",
          },
        ]
      : []),
    { value: null, label: "None", description: "Clear the write scope" },
  ];
};
const bindCells = (
  draws: Record<keyof typeof product.cells, BindingDraw<Read>> &
    Readonly<Record<string, BindingDraw<Read>>>,
): Record<string, SheetBinding> =>
  Object.fromEntries(
    Object.entries(sheetCells(product)).map(([name, { domain, home, per, ...cell }]) => {
      if (home.at === "setting" || per === "name")
        throw Error(`Unexpected Fans Work placement for ${name}`);
      const draw = { ...cell, ...draws[name] };
      const rendered =
        name === "writeIntent" && domain.kind === "value"
          ? { ...domain, kind: "enum" as const, choices: scopeChoices }
          : domain;
      if (home.at === "parameter") {
        if (per !== "subject") throw Error(`Parameter ${name} needs an element`);
        return [name, { ...draw, home, per, domain: rendered }];
      }
      return [name, { ...draw, home, per, domain: rendered }];
    }),
  );

export const fansCalc = {
  draft: true,
  // Every input reads the open fan's walk; with none open the sheet says where to open one.
  empty: (read: Read) => (read && !snapshotOf(read) ? "Open a fan from the roster." : null),
  // The design it depends on, read across routes: one line and a link that opens /ducts on it.
  from: (read: Read, search) => {
    if (read?.ductSystemsRevision == null) return null;
    const firm = read.calcView.firm;
    const snapshot = snapshotOf(read);
    const systems = snapshot ? calcSystems(snapshot) : [];
    return {
      says: `Priced with the /ducts design, Work r${read.ductSystemsRevision}${
        !firm
          ? ""
          : "refused" in firm
            ? `: ${ENGINE_DEFAULT_NO_SHARED_ROOT}. ${NO_SHARED_ROOT}`
            : !firm.present
              ? " over defaults where no home states a value"
              : ` over firm ${firm.version} · ${firm.path.split(/[\\/]/).at(-1)}`
      }`,
      href: routeAddress("duct-systems").link(
        systems.length
          ? {
              system: {
                kind: "ids",
                ids: systems.map((name) => subjectCode({ keyKind: "system-name", key: name })),
              },
            }
          : {},
        Object.fromEntries(
          ["target", "fixture", "thread"].flatMap((key) =>
            typeof search[key] === "string" ? [[key, search[key]]] : [],
          ),
        ),
      ),
    };
  },
  bindings: {
    // Design friction stays /ducts design data (ducts ledger Q2a), so Fans omits it.
    ...Object.fromEntries(
      Object.entries(ductsSettings)
        .filter(([key]) => key !== "setting.ducts.designFriction")
        .map(([key, b]) => [
          key,
          {
            ...b,
            model: (read: Read) => {
              if (b.home.at !== "setting") return null;
              const [, name] = b.home.path;
              if (b.home.path[0] === "parameters")
                return slotLayer(
                  read?.calcSnapshot && !("kind" in read.calcSnapshot) ? read.calcSnapshot : null,
                  name ?? "",
                );
              const declared = Object.entries(DUCTS_CRITERIA_CELLS).find(
                ([cell]) => key === `setting.ducts.${cell}`,
              )?.[1];
              const criteria = inputsOf(read)?.criteria;
              const resolved = declared && criteria?.[declared.layer[0]],
                side = declared?.layer[1];
              return layer(
                resolved && "supply" in resolved ? (side ? resolved[side] : undefined) : resolved,
                (v) => v,
                read,
              );
            },
          },
        ]),
    ),
    ...bindCells({
      writeIntent: {},
      roles: {
        rows: (read: Read) =>
          rowsOf(
            read,
            (snapshotOf(read)?.nodes ?? [])
              .filter((n) => n.kind === "equipment")
              .map((n) => String(n.id)),
          ),
        rowLabel: (read, row) => nameOf(read, row, "Unit role"),
        model: (read: Read, row) => {
          const id = idOf(read, row),
            resolved = id == null ? undefined : inputsOf(read)?.units[String(id)]?.role;
          if (resolved?.value != null) return layer(resolved, (role) => ({ role }));
          const node = snapshotOf(read)?.nodes.find((n) => n.id === id);
          return node
            ? { value: { role: suggestRole(node, suggestKind(node).kind) }, source: "default" }
            : null;
        },
      },
      equipmentFlows: {
        rows: (read: Read) => rowsOf(read, units(read)),
        rowLabel: (read, row) => nameOf(read, row, "Unit airflow"),
        model: (read: Read, row) => {
          const id = idOf(read, row),
            node = snapshotOf(read)?.nodes.find((n) => n.id === id);
          const conflict =
            id === fanUnit(read)
              ? read?.open?.inputs?.notes.find((n) => n.kind === "flow-conflict")?.text
              : undefined;
          const base = live(
            read,
            "equipmentFlows",
            row,
            inputsOf(read)?.units[String(id)]?.cfm,
            (v) => v,
          ) ?? { value: null };
          return {
            ...base,
            ...(conflict
              ? {
                  note: [conflict.replace(/^fan \d+: /, "Conflict: "), base.note]
                    .filter(Boolean)
                    .join(". "),
                }
              : {}),
            ...(node && node.flowParameter === null
              ? {
                  refusal: `${[node.type, node.family].filter(Boolean).join(" / ") || "This fan"} has no ${snapshotOf(read)?.slots.fanFlow ?? "selected airflow"} parameter; add it to the family or map flow to an existing parameter`,
                }
              : {}),
          };
        },
      },
      // The ESP a fan is rated for: stated here or read from its separately named parameter (P-030).
      ratedEsp: {
        rows: (read: Read) => rowsOf(read, units(read)),
        rowLabel: (read, row) => nameOf(read, row, "Unit rated ESP"),
        model: (read: Read, row) =>
          layer(inputsOf(read)?.units[String(idOf(read, row))]?.esp, (v) => ({ inWg: v })),
      },
      flows: {
        rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.terminals ?? {})),
        rowLabel: (read, row) => nameOf(read, row, "Terminal airflow"),
        model: (read: Read, row) =>
          live(
            read,
            "flows",
            row,
            inputsOf(read)?.terminals[String(idOf(read, row))]?.cfm,
            (v) => v,
          ),
      },
      terminalDrops: {
        rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.terminals ?? {})),
        rowLabel: (read, row) => nameOf(read, row, "Terminal drop"),
        model: (read: Read, row) =>
          live(
            read,
            "terminalDrops",
            row,
            inputsOf(read)?.terminals[String(idOf(read, row))]?.drop,
            (v) => ({ inWg: v }),
          ),
      },
      componentDrops: {
        rows: (read: Read) => rowsOf(read, Object.keys(inputsOf(read)?.components ?? {})),
        rowLabel: (read, row) => nameOf(read, row, "Part drop"),
        model: (read: Read, row) =>
          layer(inputsOf(read)?.components[String(idOf(read, row))]?.drop, (v) => ({ inWg: v })),
      },
    }),
  },
} as const satisfies SheetSlot;
