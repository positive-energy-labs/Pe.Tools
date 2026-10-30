/**
 * What a unit kind means for the calc, said against the unit's own ports (kaitpw 2026-10-30: the
 * kind picker "says nothing about what makes each role different"). Read off the real roster
 * (`suggestRoster` over this one unit with the kind ruled), so the words cannot drift from what the
 * engine does: which ports become fan ports, whether the unit moves air or is walked through, and
 * where its flow comes from. fan-coil, air-handler and muas price identically; the words show it.
 */
import type { DuctUnitKind, DuctsInputs } from "@pe/agent-contracts";
import { kindStripsFanPort, suggestRole, suggestRoster } from "@pe/ducts-domain/roster";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

type Node = DuctSnapshot["nodes"][number];
type Unit = DuctsInputs["units"][string];

const sideWord = (classification: string | null | undefined) =>
  (
    {
      supplyair: "supply",
      returnair: "return",
      exhaustair: "exhaust",
      outdoorair: "outdoor",
    } as Record<string, string>
  )[(classification ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? "unclassified";

const portWord = (node: Node, index: number) => {
  const c = node.connectors.find((p) => p.index === index);
  return c ? `${sideWord(c.classification)} ${c.direction === "out" ? "out" : "in"} c${index}` : `c${index}`;
};

/** The role a kind gives the unit: a typed role stands; else the engine's suggestion under that kind. */
export const roleUnder = (node: Node, kind: DuctUnitKind, unit: Unit | undefined) =>
  unit?.role.source === "typed" || unit?.role.source === "stored"
    ? unit.role.value
    : suggestRole(node, kind);

/**
 * Why ruling this kind would take the unit off the fan list, or null. The roster's own rule
 * (`kindStripsFanPort`), so the reason cannot drift from what the engine does; a unit whose role
 * is passive under the kind is off the list anyway, so the kind strips nothing.
 */
export function kindDisabledReason(node: Node, kind: DuctUnitKind, unit?: Unit): string | null {
  if (roleUnder(node, kind, unit) === "passive" || !kindStripsFanPort(node, kind)) return null;
  return `${noFanPort(node, kind)}; the unit would leave the fan list`;
}

const noFanPort = (node: Node, kind: DuctUnitKind) => {
  const outlets = node.connectors.filter((p) => p.direction === "out");
  return `no fan port: ${outlets.length} outlet${outlets.length === 1 ? "" : "s"} (${outlets
    .map((p) => portWord(node, p.index))
    .join(", ")}) where ${kind} takes exactly one`;
};

export function kindMeaning(node: Node, kind: DuctUnitKind, unit?: Unit): string {
  const role = roleUnder(node, kind, unit);
  if (role === "passive")
    return "passive: adds its drop and moves no air; the walk passes through it to what lies beyond";
  if (kind === "dehumidifier")
    return "side-stream: never proposed a fan; the walk stops at it unless a person rules its port a fan";
  const roster = suggestRoster({ nodes: [node] }, [], {
    kinds: { [String(node.id)]: kind },
    roles: { [String(node.id)]: "fan" },
  });
  const ports = [...roster.fans, ...roster.suggestions];
  const flow =
    unit?.cfm.value != null
      ? `flow ${unit.cfm.value} cfm (${unit.cfm.source}${unit.cfm.ref ? ` ${unit.cfm.ref}` : ""})`
      : kind === "erv"
        ? "flow: none stated, and an ERV's discharge reaches no terminal of its own"
        : "flow: none stated, so the sum of the terminals it serves";
  if (!ports.length)
    return `${noFanPort(node, kind)}; the walk stops at it and asks for a port pairing`;
  const fanPorts = ports
    .map(
      (p) =>
        `${portWord(node, p.portIndex)}${p.inletPortIndex != null ? ` from ${portWord(node, p.inletPortIndex)}` : ""}`,
    )
    .join("; ");
  return `fan: ${fanPorts} · ${flow}`;
}
