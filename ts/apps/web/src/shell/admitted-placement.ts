import { z } from "zod";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { SchemaTable } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { freezePage } from "./page-port";

/** Choosers are event actions; their callbacks use the same invocation path as pane verbs. */
export function placeAdmittedVerbs(
  pane: RouteGraphJson["panes"][string],
  schemas: SchemaTable,
  bodies: Readonly<Record<string, { run: (...args: any[]) => unknown }>>,
  row: unknown,
  input: unknown,
  invoke: (id: string, input: unknown) => unknown,
) {
  if (!("allowed" in pane.verbs)) throw Error("Pane has no row placement");
  const placement = pane.verbs;
  const parsed = freezePage(schemas[placement.row]!.parse(row));
  const selected = z.array(z.string()).parse(bodies[placement.choose]!.run(parsed));
  for (const id of selected)
    if (!placement.allowed.includes(id)) throw Error(`Undeclared pane verb: ${id}`);
  const captured = freezePage(structuredClone(input));
  return Object.freeze(Object.fromEntries(selected.map((id) => [id, () => invoke(id, captured)])));
}
