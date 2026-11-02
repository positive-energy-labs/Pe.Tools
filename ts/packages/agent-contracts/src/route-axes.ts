import type { CatalogAxes, CatalogLink } from "./catalog.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import type { PeRouteId } from "./pe-api.ts";

type Declaration = Omit<CatalogLink, "key" | "cardinality">;
const axes = (
  subject: CatalogAxes["subject"],
  touches: CatalogAxes["touches"],
  effect: CatalogAxes["effect"],
  cost: CatalogAxes["cost"],
  uses: CatalogLink["uses"],
): Declaration => ({ subject, touches, effect, cost, uses });

/** Audited against pe-routes.ts and its owner dispatchers, not HTTP methods or principals.
 * SessionWrite includes durable host files, caches, receipts and thread events. ModelWrite
 * means a Revit model may change. Dynamic doors declare the union of their possible children;
 * a particular request still needs the selected child's admission and cost assessment.
 */
export function hostRouteAxes(leaves: readonly CatalogLink[]): Record<PeRouteId, CatalogLink> {
  const reads = [
    ...new Set(
      [...hostOpCatalog, ...tsOnlyOperationCatalog]
        .filter((op) => op.intent === "Read")
        .map((op) => op.key),
    ),
  ];
  // The registry resolves both semantic commands and raw gateway operations.
  const commands = leaves.map((row) => row.key);
  const declarations = {
    "notices.presence": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "features.get": axes("None", ["Metadata"], "Read", "Cheap", []),
    "machine.bootstrap": axes("Session", ["Metadata"], "SessionWrite", "Mutation", []),
    // /call refuses raw mutations except the human-only RHVAC launcher. Reads can retain
    // captures and execute scripts, including transactional previews; budget conservatively.
    "operation.call": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      [...reads, "scripting.execute", "rhvac.launch"],
    ),
    "actions.admit": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      commands,
    ),
    "actions.read": axes("Session", ["Metadata"], "Read", "Bounded", []),
    "action.cancel": axes("Session", ["Metadata"], "SessionWrite", "Mutation", ["op.cancel"]),
    "action.recover": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "action.resume": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      commands,
    ),
    "providers.list": axes("None", ["Metadata"], "Read", "Cheap", []),
    "providers.add": axes("None", ["Metadata"], "SessionWrite", "Mutation", []),
    "provider.get": axes("None", ["Metadata"], "Read", "Cheap", []),
    "provider.remove": axes("None", ["Metadata"], "SessionWrite", "Cheap", []),
    "provider.probe": axes("None", ["Metadata"], "SessionWrite", "Expensive", []),
    "provider.login": axes("None", ["Metadata"], "SessionWrite", "Mutation", []),
    "plugins.routes": axes("None", ["Metadata"], "SessionWrite", "Bounded", []),
    "plugins.routeTrust": axes("None", ["Metadata"], "SessionWrite", "Mutation", [
      "route:plugins.routes",
    ]),
    "plugins.routeBundle": axes("None", ["Metadata"], "SessionWrite", "Bounded", [
      "route:plugins.routes",
    ]),
    "plugins.list": axes("None", ["Metadata"], "Read", "Cheap", []),
    "plugin.update": axes("None", ["Metadata"], "SessionWrite", "Mutation", [
      "route:plugins.routes",
    ]),
    "tasks.list": axes("None", ["Metadata"], "Read", "Cheap", []),
    "tasks.enabled": axes("None", ["Metadata"], "SessionWrite", "Cheap", []),
    // The scheduled harness and prompted threads can themselves dispatch arbitrary actions.
    "tasks.run": axes("Session", ["Metadata", "Topology", "Geometry"], "ModelWrite", "Mutation", [
      "route:thread.prompt",
    ]),
    "threads.history": axes("Session", ["Metadata"], "Read", "Bounded", []),
    "threads.list": axes("Session", ["Metadata"], "Read", "Cheap", []),
    "threads.create": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.get": axes("Session", ["Metadata"], "Read", "Cheap", []),
    "thread.export": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.update": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.place": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "thread.remove": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.prompt": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:actions.admit", "route:operation.call"],
    ),
    "thread.queue": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:thread.prompt"],
    ),
    "thread.wait": axes("Session", ["Metadata"], "Read", "Bounded", []),
    "thread.cancel": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.permission": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:thread.prompt"],
    ),
    "thread.question": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:thread.prompt"],
    ),
    "thread.fork": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.model": axes("Session", ["Metadata"], "SessionWrite", "Expensive", []),
    "thread.trait": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "scope.get": axes("Session", ["Metadata"], "Read", "Cheap", []),
    "scope.set": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "navigation.get": axes("Session", ["Metadata"], "Read", "Bounded", ["route:threads.list"]),
    "thread-work.get": axes("Session", ["Metadata"], "Read", "Bounded", ["route:threads.list"]),
    "work.resume": axes("Document", ["Metadata"], "Read", "Bounded", []),
    "turn.element-names": axes("Elements", ["Metadata"], "SessionWrite", "Bounded", [
      "revit.detail.elements",
    ]),
    // Capability publication may write harness skill/config files on a cold cache.
    "capabilities.find": axes("Session", ["Metadata"], "SessionWrite", "Expensive", [
      "host.ops.catalog",
    ]),
    "contributions.read": axes("None", ["Metadata"], "SessionWrite", "Expensive", []),
    "family.spec": axes("None", ["Metadata"], "Read", "Cheap", []),
    "feedback.submit": axes("None", ["Metadata"], "SessionWrite", "Bounded", []),
    "feedback.deliver": axes("None", ["Metadata"], "SessionWrite", "Expensive", []),
    "agent-feedback.submit": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    "diagnostics.submit": axes("None", ["Metadata"], "SessionWrite", "Bounded", []),
    "receipts.read": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
    // Resource streams dispatch by Reading kind, including native acquisitions and captures.
    "resources.stream": axes(
      "Session",
      ["Metadata", "Topology", "Geometry"],
      "SessionWrite",
      "Expensive",
      [
        "route:capabilities.find",
        "ducts.snapshot",
        "ducts.tables",
        "revit.catalog.field-options",
        "families.capture",
        "family.capture",
        "takeoffs.snapshot",
        "revit.detail.schedules",
      ],
    ),
    "log.read": axes("Session", ["Metadata"], "Read", "Bounded", []),
    "work.list": axes("None", ["Metadata"], "Read", "Cheap", []),
    "route-settings.get": axes("None", ["Metadata"], "Read", "Cheap", []),
    "route-settings.set": axes("None", ["Metadata"], "SessionWrite", "Cheap", []),
    "work.get": axes("Document", ["Metadata"], "Read", "Bounded", []),
    "work.salvage": axes("Document", ["Metadata"], "Read", "Bounded", []),
    "work.apply": axes("Document", ["Metadata"], "SessionWrite", "Bounded", []),
    "work.fresh": axes("Document", ["Metadata"], "SessionWrite", "Bounded", []),
    // These owners currently call the legacy snapshot dispatcher, not the split roster/walk ops.
    "ducts.sheet": axes("Elements", ["Metadata", "Topology", "Geometry"], "Read", "Expensive", [
      "ducts.snapshot",
      "ducts.tables",
    ]),
    "ducts.roster": axes("Document", ["Metadata", "Topology"], "Read", "Bounded", [
      "ducts.snapshot",
    ]),
    "ducts.analysis": axes(
      "Document",
      ["Metadata", "Topology", "Geometry"],
      "SessionWrite",
      "Expensive",
      ["ducts.snapshot", "ducts.tables"],
    ),
    "ducts.analysis-artifact": axes("None", ["Metadata"], "Read", "Bounded", []),
    "space.scene-artifact": axes("None", ["Geometry"], "Read", "Bounded", []),
    "view.get": axes("Session", ["Metadata"], "Read", "Cheap", []),
    "view.open": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.publish": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.set": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.ack": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.remove": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "share.set": axes("Session", ["Metadata"], "SessionWrite", "Mutation", []),
    "device.list": axes("Session", ["Metadata"], "Read", "Cheap", []),
    "device.pair": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.revoke": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.bind": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.claim": axes("Session", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.environment": axes("Session", ["Metadata"], "Read", "Cheap", []),
    "page.export": axes("Document", ["Metadata"], "Read", "Bounded", []),
    "page.publish": axes("None", ["Metadata"], "SessionWrite", "Mutation", []),
    "page.target": axes("Session", ["Metadata"], "Read", "Cheap", []),
    "page.call": axes("Session", ["Metadata", "Topology", "Geometry"], "ModelWrite", "Mutation", [
      "route:operation.call",
    ]),
    "page.act": axes("Session", ["Metadata", "Topology", "Geometry"], "ModelWrite", "Mutation", [
      "route:actions.admit",
    ]),
    "page.state": axes("None", ["Metadata"], "Read", "Bounded", []),
    "page.append": axes("None", ["Metadata"], "SessionWrite", "Cheap", []),
    "page.events": axes("None", ["Metadata"], "Read", "Bounded", []),
    "page.snapshot": axes("None", ["Metadata"], "SessionWrite", "Bounded", []),
    "page.text": axes("None", ["Metadata"], "SessionWrite", "Bounded", []),
    "page.bind": axes("Session", ["Metadata"], "SessionWrite", "Bounded", []),
  } satisfies Record<PeRouteId, Declaration>;
  const entries = new Map(leaves.map((row) => [row.key, row]));
  for (const [id, declaration] of Object.entries(declarations))
    entries.set(`route:${id}`, { key: `route:${id}`, cardinality: "One", ...declaration });
  function touches(row: CatalogLink): CatalogAxes["touches"] {
    return [
      ...new Set([
        ...row.touches,
        ...row.uses.flatMap((use) => {
          const child = entries.get(typeof use === "string" ? use : use.key);
          if (!child)
            throw Error(
              `${row.key}: unknown dependency ${typeof use === "string" ? use : use.key}`,
            );
          return touches(child);
        }),
      ]),
    ];
  }
  return Object.fromEntries(
    Object.keys(declarations).map((id) => {
      const row = entries.get(`route:${id}`)!;
      return [id, { ...row, touches: touches(row) }];
    }),
  ) as Record<PeRouteId, CatalogLink>;
}
