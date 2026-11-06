import { FAN_READ_MAX } from "./fans-read.ts";
import type { CatalogAxes, CatalogLink } from "./catalog.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import type { PeRouteId } from "./pe-api.ts";

type Declaration = Omit<CatalogLink, "key">;
const axes = (
  subject: CatalogAxes["subject"],
  cardinality: CatalogAxes["cardinality"],
  touches: CatalogAxes["touches"],
  effect: CatalogAxes["effect"],
  cost: CatalogAxes["cost"],
  uses: CatalogLink["uses"],
): Declaration => ({ subject, cardinality, touches, effect, cost, uses });

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
    "families.readings": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "takeoffs.observations": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "captures.list": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "ducts.catalogs": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "notices.presence": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "features.get": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "machine.bootstrap": axes("Session", "One", ["Metadata"], "SessionWrite", "Mutation", []),
    // /call refuses raw mutations except the human-only RHVAC launcher. Reads can retain
    // captures and execute scripts, including transactional previews; budget conservatively.
    "operation.call": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      [...reads, "scripting.execute", "rhvac.launch"],
    ),
    "actions.admit": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      commands,
    ),
    "actions.read": axes("Session", "One", ["Metadata"], "Read", "Bounded", []),
    "action.cancel": axes("Session", "One", ["Metadata"], "SessionWrite", "Mutation", [
      "op.cancel",
    ]),
    "action.recover": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "action.resume": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      commands,
    ),
    "providers.list": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "providers.add": axes("None", "One", ["Metadata"], "SessionWrite", "Mutation", []),
    "provider.get": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "provider.remove": axes("None", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "provider.probe": axes("None", "One", ["Metadata"], "SessionWrite", "Expensive", []),
    "provider.login": axes("None", "One", ["Metadata"], "SessionWrite", "Mutation", []),
    "plugins.routes": axes("None", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "plugins.routeTrust": axes("None", "One", ["Metadata"], "SessionWrite", "Mutation", [
      "route:plugins.routes",
    ]),
    "plugins.routeBundle": axes("None", "One", ["Metadata"], "SessionWrite", "Bounded", [
      "route:plugins.routes",
    ]),
    "plugins.list": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "plugin.update": axes("None", "One", ["Metadata"], "SessionWrite", "Mutation", [
      "route:plugins.routes",
    ]),
    "tasks.list": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "tasks.enabled": axes("None", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    // The scheduled harness and prompted threads can themselves dispatch arbitrary actions.
    "tasks.run": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:thread.prompt"],
    ),
    "threads.history": axes("Session", "One", ["Metadata"], "Read", "Bounded", []),
    "threads.list": axes("Session", "One", ["Metadata"], "Read", "Cheap", []),
    "threads.create": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.get": axes("Session", "One", ["Metadata"], "Read", "Cheap", []),
    "thread.export": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.update": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.place": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "thread.remove": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.prompt": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:actions.admit", "route:operation.call"],
    ),
    "thread.queue": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:thread.prompt"],
    ),
    "thread.wait": axes("Session", "One", ["Metadata"], "Read", "Bounded", []),
    "thread.cancel": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.permission": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:thread.prompt"],
    ),
    "thread.question": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:thread.prompt"],
    ),
    "thread.fork": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "thread.model": axes("Session", "One", ["Metadata"], "SessionWrite", "Expensive", []),
    "thread.trait": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "scope.get": axes("Session", "One", ["Metadata"], "Read", "Cheap", []),
    "scope.set": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "navigation.get": axes("Session", "One", ["Metadata"], "Read", "Bounded", [
      "route:threads.list",
    ]),
    "thread-work.get": axes("Session", "One", ["Metadata"], "Read", "Bounded", [
      "route:threads.list",
    ]),
    "work.resume": axes("Document", "One", ["Metadata"], "Read", "Bounded", []),
    "turn.element-names": axes("Elements", "One", ["Metadata"], "SessionWrite", "Bounded", [
      "revit.detail.elements",
    ]),
    // Capability publication may write harness skill/config files on a cold cache.
    "capabilities.find": axes("Session", "One", ["Metadata"], "SessionWrite", "Expensive", [
      "host.ops.catalog",
    ]),
    "contributions.read": axes("None", "One", ["Metadata"], "SessionWrite", "Expensive", []),
    "family.spec": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "feedback.submit": axes("None", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "feedback.deliver": axes("None", "One", ["Metadata"], "SessionWrite", "Expensive", []),
    "agent-feedback.submit": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "diagnostics.submit": axes("None", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "receipts.read": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    // Resource streams dispatch by Reading kind, including native acquisitions and captures.
    "resources.stream": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "SessionWrite",
      "Expensive",
      [
        "route:capabilities.find",
        "ducts.snapshot.roster",
        "ducts.snapshot.walk",
        "ducts.tables",
        "revit.catalog.field-options",
        "families.capture",
        "family.capture",
        "takeoffs.snapshot",
        "revit.detail.schedules",
      ],
    ),
    "resources.subscriptions": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "SessionWrite",
      "Expensive",
      [
        "route:capabilities.find",
        "ducts.snapshot.roster",
        "ducts.snapshot.walk",
        "ducts.tables",
        "revit.catalog.field-options",
        "families.capture",
        "family.capture",
        "takeoffs.snapshot",
        "revit.detail.schedules",
      ],
    ),
    "log.read": axes("Session", "One", ["Metadata"], "Read", "Bounded", []),
    "work.list": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "route-settings.get": axes("None", "One", ["Metadata"], "Read", "Cheap", []),
    "route-settings.set": axes("None", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "work.get": axes("Document", "One", ["Metadata"], "Read", "Bounded", []),
    "work.salvage": axes("Document", "One", ["Metadata"], "Read", "Bounded", []),
    "work.apply": axes("Document", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "work.fresh": axes("Document", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "work.history": axes("Document", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "reads.events": axes("None", "Many", ["Metadata"], "Read", "Cheap", []),
    "fans.sheet": { ...axes("Document", "Many", ["Metadata", "Topology", "Geometry"], "Read", "Bounded", ["ducts.snapshot.roster", "ducts.snapshot.walk", "ducts.tables"]), cap: FAN_READ_MAX },
    "ducts.sheet": axes(
      "Elements",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "Read",
      "Expensive",
      ["ducts.snapshot.roster", "ducts.snapshot.walk", "ducts.tables"],
    ),
    "ducts.roster": axes("Document", "One", ["Metadata", "Topology"], "Read", "Bounded", [
      "ducts.snapshot.roster",
    ]),
    "ducts.analysis": axes(
      "Document",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "SessionWrite",
      "Expensive",
      ["ducts.snapshot.roster", "ducts.snapshot.walk", "ducts.tables"],
    ),
    "ducts.analysis-artifact": axes("None", "One", ["Metadata"], "Read", "Bounded", []),
    "space.scene-artifact": axes("None", "One", ["Geometry"], "Read", "Bounded", []),
    "view.get": axes("Session", "One", ["Metadata"], "Read", "Cheap", []),
    "view.open": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.publish": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.set": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.ack": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "view.remove": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "share.set": axes("Session", "One", ["Metadata"], "SessionWrite", "Mutation", []),
    "device.list": axes("Session", "One", ["Metadata"], "Read", "Cheap", []),
    "device.pair": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.revoke": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.bind": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.claim": axes("Session", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "device.environment": axes("Session", "One", ["Metadata"], "Read", "Cheap", []),
    "page.export": axes("Document", "One", ["Metadata"], "Read", "Bounded", []),
    "page.publish": axes("None", "One", ["Metadata"], "SessionWrite", "Mutation", []),
    "page.target": axes("Session", "One", ["Metadata"], "Read", "Cheap", []),
    "page.call": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:operation.call"],
    ),
    "page.act": axes(
      "Session",
      "One",
      ["Metadata", "Topology", "Geometry"],
      "ModelWrite",
      "Mutation",
      ["route:actions.admit"],
    ),
    "page.state": axes("None", "One", ["Metadata"], "Read", "Bounded", []),
    "page.append": axes("None", "One", ["Metadata"], "SessionWrite", "Cheap", []),
    "page.events": axes("None", "One", ["Metadata"], "Read", "Bounded", []),
    "page.snapshot": axes("None", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "page.text": axes("None", "One", ["Metadata"], "SessionWrite", "Bounded", []),
    "page.bind": axes("Session", "One", ["Metadata"], "SessionWrite", "Bounded", []),
  } satisfies Record<PeRouteId, Declaration>;
  const entries = new Map(leaves.map((row) => [row.key, row]));
  for (const [id, declaration] of Object.entries(declarations))
    entries.set(`route:${id}`, { key: `route:${id}`, ...declaration });
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
