import { snapshot } from "./test-fixture";

/** RA 23's shape: one zero-flow dangling duct end, with no finding required to name it. */
export function ra23Snapshot() {
  const ducts = structuredClone(snapshot);
  for (const element of [...ducts.nodes, ...ducts.segments]) {
    if (element.id === 1) element.id = 10002955;
    if (element.groupId) element.groupId = "g10002953";
    if (element.systemName) element.systemName = "RA 23";
    for (const port of element.connectors)
      if (port.connectedTo?.elementId === 1) port.connectedTo.elementId = 10002955;
  }
  ducts.nodes[0]!.facts = [{ ...ducts.nodes[0]!.facts[0]!, key: "mark", text: "DH-17" }];
  ducts.groups[0]!.id = "g10002953";
  ducts.groups[0]!.systemNames = ["RA 23"];
  ducts.systems[0]!.name = "RA 23";
  ducts.segments[0]!.connectors.push({
    ...ducts.segments[0]!.connectors[0]!,
    index: 9,
    point: [-10, 0, 0],
    facing: [-1, 0, 0],
    diameterIn: 8,
    flowCfm: 0,
    connectedTo: null,
  });
  return ducts;
}
