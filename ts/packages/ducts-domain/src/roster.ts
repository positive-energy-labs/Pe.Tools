import type { DuctSnapshot } from "./types.ts";

export interface FanPort {
  unitId: number;
  portIndex: number;
  tag: string;
  side: "supply" | "return" | "exhaust" | "outdoor";
  kind: "fan-coil" | "air-handler" | "erv" | "muas" | "dehumidifier" | "other";
  source: "base-equipment" | "ruling" | "heuristic";
  /** Return-side walk starts here; absent means the inlet is missing or ambiguous. */
  inletPortIndex?: number;
}

export interface RosterRuling {
  unitId: number;
  portIndex: number;
  decision: "fan" | "not-fan";
  side?: FanPort["side"];
  at: string;
}

export interface Roster {
  fans: FanPort[];
  suggestions: FanPort[];
}

export type RosterSnapshot = Pick<DuctSnapshot, "nodes"> & Partial<Pick<DuctSnapshot, "systems">>;
type Node = DuctSnapshot["nodes"][number];
type Port = Node["connectors"][number];
const key = (port: Pick<FanPort, "unitId" | "portIndex">) => `${port.unitId}:${port.portIndex}`;
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const name = (node: Node) => words(`${node.family ?? ""} ${node.type ?? ""}`);
const passiveName = (node: Node) => /\b(filter|chassis|silencer|heater|damper)\b/.test(name(node));

/** The family and type name read as a hint only (ducts LEDGER 2026-10-29: never a value of its own). */
function nameKind(node: Node): FanPort["kind"] | null {
  const text = name(node);
  if (/\b(fan coil|fancoil|fcu)\b/.test(text)) return "fan-coil";
  if (/\b(muas?|make up air|makeup air)\b/.test(text)) return "muas";
  if (/\b(ahu|air handler|air handling|suntherm|mortex)\b/.test(text)) return "air-handler";
  if (/\b(erv|broan|renewaire)\b/.test(text)) return "erv";
  if (/\b(dehumidifier|aprilaire|santa fe)\b/.test(text)) return "dehumidifier";
  return null;
}

/**
 * A unit's kind suggested from what its duct ports carry (ducts LEDGER 2026-10-29): supply and
 * return with exhaust or outdoor is an ERV; outdoor into supply with no return is a make-up air
 * unit; supply and return alone is a fan coil unless the name says air handler or dehumidifier;
 * anything else falls to the name, then `other`. A ruling per family type overrides it.
 */
export function suggestKind(node: Node): { kind: FanPort["kind"]; ref: string } {
  const classes = new Set(
    node.connectors.flatMap((p) => {
      const side = sideOf(p);
      return side ? [side] : [];
    }),
  );
  const hint = nameKind(node);
  const has = (c: FanPort["side"]) => classes.has(c);
  if (has("supply") && has("return") && (has("exhaust") || has("outdoor")))
    return { kind: "erv", ref: "ports" };
  if (has("supply") && has("outdoor") && !has("return")) return { kind: "muas", ref: "ports" };
  // Supply and return alone fit several kinds: a name that says which wins over the fan-coil default.
  if (has("supply") && has("return"))
    return hint && hint !== "fan-coil"
      ? { kind: hint, ref: "ports+name" }
      : { kind: "fan-coil", ref: "ports" };
  return hint ? { kind: hint, ref: "name" } : { kind: "other", ref: "none" };
}

/** A unit's role suggested from its name (a filter, heater or damper chassis is passive) and kind. */
export function suggestRole(node: Node, kind: FanPort["kind"]): "fan" | "passive" {
  return passiveName(node) || kind === "other" ? "passive" : "fan";
}

/** Resolved kinds and roles by unit element id (`resolveInputs`); absent, the suggestions. */
export interface RosterInputs {
  kinds?: Readonly<Record<string, FanPort["kind"]>>;
  roles?: Readonly<Record<string, "fan" | "passive">>;
}

function sideOf(port: Port): FanPort["side"] | undefined {
  switch (words(port.classification ?? "").replaceAll(" ", "")) {
    case "supplyair":
      return "supply";
    case "returnair":
      return "return";
    case "exhaustair":
      return "exhaust";
    case "outdoorair":
      return "outdoor";
    default:
      return undefined;
  }
}

function fanPort(
  node: Node,
  port: Port,
  side: FanPort["side"],
  source: FanPort["source"],
  kindOf: (node: Node) => FanPort["kind"],
): FanPort {
  const kind = kindOf(node);
  const inlets = node.connectors.filter(
    (p) =>
      p.direction === "in" &&
      (kind !== "erv" ||
        (side === "exhaust"
          ? sideOf(p) === "exhaust" || sideOf(p) === "return"
          : sideOf(p) === "supply" || sideOf(p) === "outdoor")),
  );
  // The raw collector's mark fact already prefers PE_G___TagInstance over built-in Mark.
  const tag =
    node.facts.find((f) => f.key === "PE_G___TagInstance" && f.text?.trim())?.text?.trim() ??
    node.facts.find((f) => f.key === "mark")?.text?.trim() ??
    "";
  return {
    unitId: node.id,
    portIndex: port.index,
    tag,
    side,
    kind,
    source,
    ...(inlets.length === 1 ? { inletPortIndex: inlets[0]!.index } : {}),
  };
}

function inferredPorts(
  node: Node,
  source: FanPort["source"],
  kindOf: (node: Node) => FanPort["kind"],
): FanPort[] {
  const outlets = node.connectors.filter((p) => p.direction === "out");
  if (kindOf(node) === "erv") {
    return (["supply", "exhaust"] as const).flatMap((side) => {
      const matches = outlets.filter((p) => sideOf(p) === side);
      return matches.length === 1 ? [fanPort(node, matches[0]!, side, source, kindOf)] : [];
    });
  }
  const outlet = outlets.length === 1 ? outlets[0] : undefined;
  const side = outlet && sideOf(outlet);
  return outlet && side ? [fanPort(node, outlet, side, source, kindOf)] : [];
}

/**
 * The fan ports a kind finds on a unit's own connectors: an ERV needs exactly one classified outlet
 * per side, every other fan kind exactly one outlet, and `other` / `dehumidifier` are never
 * proposed a fan. The one rule the roster and the sheet's kind options both read.
 */
export function kindFanPorts(node: Node, kind: FanPort["kind"]): FanPort[] {
  if (kind === "other" || kind === "dehumidifier") return [];
  return inferredPorts(node, "heuristic", () => kind);
}

/**
 * True when ruling this kind would leave a unit that proposes fans with no fan port at all: the
 * unit would drop off the fan list. `other` and `dehumidifier` never propose a fan, so they are
 * a different story (passive, side-stream) and never "strip".
 */
export function kindStripsFanPort(node: Node, kind: FanPort["kind"]): boolean {
  return kind !== "other" && kind !== "dehumidifier" && kindFanPorts(node, kind).length === 0;
}

/** Seeds are proposals, including Revit base equipment. Only a person's fan ruling confirms one. */
export function applyRulings(
  suggestions: readonly FanPort[],
  rulings: readonly RosterRuling[],
): Roster {
  const latest = new Map<string, RosterRuling>();
  for (const ruling of rulings) {
    const previous = latest.get(key(ruling));
    if (!previous || Date.parse(ruling.at) >= Date.parse(previous.at))
      latest.set(key(ruling), ruling);
  }
  const result: Roster = { fans: [], suggestions: [] };
  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    const id = key(suggestion);
    if (seen.has(id)) continue;
    seen.add(id);
    const ruling = latest.get(id);
    if (ruling?.decision === "not-fan") continue;
    if (ruling?.decision === "fan") {
      result.fans.push({ ...suggestion, side: ruling.side ?? suggestion.side, source: "ruling" });
    } else result.suggestions.push({ ...suggestion });
  }
  return result;
}

/** Base equipment first, explicit port rulings next, family/type heuristics last. */
export function suggestRoster(
  snapshot: RosterSnapshot,
  rulings: readonly RosterRuling[] = [],
  inputs: RosterInputs = {},
): Roster {
  const kindOf = (node: Node) => inputs.kinds?.[String(node.id)] ?? suggestKind(node).kind;
  const roleOf = (node: Node) => inputs.roles?.[String(node.id)] ?? suggestRole(node, kindOf(node));
  const equipment = snapshot.nodes.filter(
    (node) => node.kind === "equipment" && roleOf(node) !== "passive",
  );
  const nodes = new Map(equipment.map((node) => [node.id, node]));
  const candidates = new Map<string, FanPort>();
  const add = (port: FanPort) => {
    if (!candidates.has(key(port))) candidates.set(key(port), port);
  };
  for (const system of snapshot.systems ?? []) {
    const node = system.baseEquipmentId == null ? undefined : nodes.get(system.baseEquipmentId);
    if (!node || kindOf(node) === "dehumidifier") continue;
    if (system.baseEquipmentConnector != null) {
      const port = node.connectors.find(
        (p) => p.index === system.baseEquipmentConnector && p.direction === "out",
      );
      const side =
        port && sideOf({ ...port, classification: port.classification ?? system.classification });
      if (port && side) add(fanPort(node, port, side, "base-equipment", kindOf));
    } else {
      for (const port of inferredPorts(node, "base-equipment", kindOf)) add(port);
    }
  }
  for (const ruling of rulings) {
    const node = nodes.get(ruling.unitId);
    const port = node?.connectors.find((p) => p.index === ruling.portIndex);
    const side = ruling.side ?? (port && sideOf(port));
    if (node && port && side && ruling.decision === "fan")
      add(fanPort(node, port, side, "ruling", kindOf));
  }
  for (const node of equipment) {
    const kind = kindOf(node);
    // A fan ruling is the explicit opt-in for a side-stream dehumidifier (`kindFanPorts` is empty for it).
    for (const port of kindFanPorts(node, kind)) add(port);
  }
  return applyRulings([...candidates.values()], rulings);
}

/** Counts proposed + confirmed ports, never implies the engineer has confirmed the census. */
export function rosterCensus(snapshot: RosterSnapshot, rulings: readonly RosterRuling[] = []) {
  const roster = suggestRoster(snapshot, rulings);
  const ports = [...roster.fans, ...roster.suggestions];
  const byKind: Record<FanPort["kind"], number> = {
    "fan-coil": 0,
    "air-handler": 0,
    erv: 0,
    muas: 0,
    dehumidifier: 0,
    other: 0,
  };
  const bySource: Record<FanPort["source"], number> = {
    "base-equipment": 0,
    ruling: 0,
    heuristic: 0,
  };
  for (const port of ports) {
    byKind[port.kind]++;
    bySource[port.source]++;
  }
  const kindOf = (node: Node) => suggestKind(node).kind;
  const equipment = snapshot.nodes.filter(
    (node) => node.kind === "equipment" && suggestRole(node, kindOf(node)) !== "passive",
  );
  return {
    units: new Set(ports.map((port) => port.unitId)).size,
    ports: ports.length,
    confirmed: roster.fans.length,
    pending: roster.suggestions.length,
    byKind,
    bySource,
    baseEquipmentAvailable: (snapshot.systems ?? []).some(
      (system) => system.baseEquipmentId != null,
    ),
    unclassified: equipment
      .filter((node) => kindOf(node) === "other")
      .map((node) => ({ unitId: node.id, family: node.family ?? "", type: node.type ?? "" })),
    unresolvedPorts: equipment
      .filter((node) => {
        const kind = kindOf(node);
        return (
          kind !== "other" &&
          kind !== "dehumidifier" &&
          inferredPorts(node, "heuristic", kindOf).length !== (kind === "erv" ? 2 : 1)
        );
      })
      .map((node) => ({ unitId: node.id, family: node.family ?? "", type: node.type ?? "" })),
  };
}
