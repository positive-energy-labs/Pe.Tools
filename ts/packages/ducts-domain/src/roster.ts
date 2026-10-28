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

export type RosterSnapshot = Pick<DuctSnapshot, "nodes"> &
  Partial<Pick<DuctSnapshot, "systems">>;
type Node = DuctSnapshot["nodes"][number];
type Port = Node["connectors"][number];
const key = (port: Pick<FanPort, "unitId" | "portIndex">) =>
  `${port.unitId}:${port.portIndex}`;
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const name = (node: Node) => words(`${node.family ?? ""} ${node.type ?? ""}`);
const passive = (node: Node) => /\b(filter|chassis|silencer|heater|damper)\b/.test(name(node));

function kindOf(node: Node): FanPort["kind"] {
  const text = name(node);
  if (/\b(fan coil|fancoil|fcu)\b/.test(text)) return "fan-coil";
  if (/\b(muas?|make up air|makeup air)\b/.test(text)) return "muas";
  if (/\b(ahu|air handler|air handling|suntherm|mortex)\b/.test(text)) return "air-handler";
  if (/\b(erv|broan|renewaire)\b/.test(text)) return "erv";
  if (/\b(dehumidifier|aprilaire|santa fe)\b/.test(text)) return "dehumidifier";
  return "other";
}

function sideOf(port: Port): FanPort["side"] | undefined {
  switch (words(port.classification ?? "").replaceAll(" ", "")) {
    case "supplyair": return "supply";
    case "returnair": return "return";
    case "exhaustair": return "exhaust";
    case "outdoorair": return "outdoor";
    default: return undefined;
  }
}

function fanPort(node: Node, port: Port, side: FanPort["side"], source: FanPort["source"]): FanPort {
  const kind = kindOf(node);
  const inlets = node.connectors.filter((p) => p.direction === "in" &&
    (kind !== "erv" || (side === "exhaust"
      ? sideOf(p) === "exhaust" || sideOf(p) === "return"
      : sideOf(p) === "supply" || sideOf(p) === "outdoor")));
  // The raw collector's mark fact already prefers PE_G___TagInstance over built-in Mark.
  const tag = node.facts.find((f) => f.key === "PE_G___TagInstance" && f.text?.trim())?.text?.trim()
    ?? node.facts.find((f) => f.key === "mark")?.text?.trim() ?? "";
  return {
    unitId: node.id, portIndex: port.index, tag, side, kind, source,
    ...(inlets.length === 1 ? { inletPortIndex: inlets[0]!.index } : {}),
  };
}

function inferredPorts(node: Node, source: FanPort["source"]): FanPort[] {
  const outlets = node.connectors.filter((p) => p.direction === "out");
  if (kindOf(node) === "erv") {
    return (["supply", "exhaust"] as const).flatMap((side) => {
      const matches = outlets.filter((p) => sideOf(p) === side);
      return matches.length === 1 ? [fanPort(node, matches[0]!, side, source)] : [];
    });
  }
  const outlet = outlets.length === 1 ? outlets[0] : undefined;
  const side = outlet && sideOf(outlet);
  return outlet && side ? [fanPort(node, outlet, side, source)] : [];
}

/** Seeds are proposals, including Revit base equipment. Only a person's fan ruling confirms one. */
export function applyRulings(suggestions: readonly FanPort[], rulings: readonly RosterRuling[]): Roster {
  const latest = new Map<string, RosterRuling>();
  for (const ruling of rulings) {
    const previous = latest.get(key(ruling));
    if (!previous || Date.parse(ruling.at) >= Date.parse(previous.at)) latest.set(key(ruling), ruling);
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
export function suggestRoster(snapshot: RosterSnapshot, rulings: readonly RosterRuling[] = []): Roster {
  const equipment = snapshot.nodes.filter((node) => node.kind === "equipment" && !passive(node));
  const nodes = new Map(equipment.map((node) => [node.id, node]));
  const candidates = new Map<string, FanPort>();
  const add = (port: FanPort) => { if (!candidates.has(key(port))) candidates.set(key(port), port); };
  for (const system of snapshot.systems ?? []) {
    const node = system.baseEquipmentId == null ? undefined : nodes.get(system.baseEquipmentId);
    if (!node || kindOf(node) === "dehumidifier") continue;
    if (system.baseEquipmentConnector != null) {
      const port = node.connectors.find((p) => p.index === system.baseEquipmentConnector && p.direction === "out");
      const side = port && sideOf({ ...port, classification: port.classification ?? system.classification });
      if (port && side) add(fanPort(node, port, side, "base-equipment"));
    } else {
      for (const port of inferredPorts(node, "base-equipment")) add(port);
    }
  }
  for (const ruling of rulings) {
    const node = nodes.get(ruling.unitId);
    const port = node?.connectors.find((p) => p.index === ruling.portIndex);
    const side = ruling.side ?? (port && sideOf(port));
    if (node && port && side && ruling.decision === "fan") add(fanPort(node, port, side, "ruling"));
  }
  for (const node of equipment) {
    const kind = kindOf(node);
    // A fan ruling is the explicit opt-in for a side-stream dehumidifier.
    if (kind === "other" || kind === "dehumidifier") continue;
    for (const port of inferredPorts(node, "heuristic")) add(port);
  }
  return applyRulings([...candidates.values()], rulings);
}

/** Counts proposed + confirmed ports, never implies the engineer has confirmed the census. */
export function rosterCensus(snapshot: RosterSnapshot, rulings: readonly RosterRuling[] = []) {
  const roster = suggestRoster(snapshot, rulings);
  const ports = [...roster.fans, ...roster.suggestions];
  const byKind: Record<FanPort["kind"], number> = {
    "fan-coil": 0, "air-handler": 0, erv: 0, muas: 0, dehumidifier: 0, other: 0,
  };
  const bySource: Record<FanPort["source"], number> = { "base-equipment": 0, ruling: 0, heuristic: 0 };
  for (const port of ports) { byKind[port.kind]++; bySource[port.source]++; }
  const equipment = snapshot.nodes.filter((node) => node.kind === "equipment" && !passive(node));
  return {
    units: new Set(ports.map((port) => port.unitId)).size,
    ports: ports.length, confirmed: roster.fans.length, pending: roster.suggestions.length,
    byKind, bySource,
    baseEquipmentAvailable: (snapshot.systems ?? []).some((system) => system.baseEquipmentId != null),
    unclassified: equipment.filter((node) => kindOf(node) === "other")
      .map((node) => ({ unitId: node.id, family: node.family ?? "", type: node.type ?? "" })),
    unresolvedPorts: equipment.filter((node) => {
      const kind = kindOf(node);
      return kind !== "other" && kind !== "dehumidifier" &&
        inferredPorts(node, "heuristic").length !== (kind === "erv" ? 2 : 1);
    }).map((node) => ({ unitId: node.id, family: node.family ?? "", type: node.type ?? "" })),
  };
}
