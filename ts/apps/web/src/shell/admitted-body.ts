import type { InvocationToken } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { createAdmittedCellActions } from "./admitted-cells.ts";
import type { MountedBindings,MountedRoute,MountedSnapshot,Snapshots } from "./admitted-context.ts";
import type { createAdmittedGeometry } from "./admitted-geometry.ts";
import type { createAdmittedHistory } from "./admitted-history.ts";
import type { createAdmittedInvocation } from "./admitted-invoke.ts";
import type { createAdmittedObservers } from "./admitted-observers.ts";
import type { createPagePorts } from "./page-port.ts";
export function createAdmittedBody<W extends Record<string, unknown>>({route, read, resolve, ports, snapshots, geometry, observers, invocation, historyOwner, transitionCell, duringDraw}: {
 route: MountedRoute<W>; read(): MountedSnapshot<W>; resolve(): MountedBindings; ports: ReturnType<typeof createPagePorts>;
 snapshots(): Snapshots; geometry: ReturnType<typeof createAdmittedGeometry>; observers: ReturnType<typeof createAdmittedObservers>;
 invocation: ReturnType<typeof createAdmittedInvocation<W>>; historyOwner: ReturnType<typeof createAdmittedHistory<W>>;
 transitionCell: ReturnType<typeof createAdmittedCellActions<W>>; duringDraw<T>(draw: () => T): T;
}) {
 const {workBasis, place, invoke} = invocation;
 const {history, recovery, startFresh, salvage} = historyOwner;
  return (pane: string) => {
          const current = resolve();
          if (!Object.hasOwn(route.data.panes, pane)) throw Error(`Unknown pane: ${pane}`);
          const declaration = route.data.panes[pane]!;
          if (!observers.visible(pane) || !declaration.body) return null;
          const basis = workBasis();
          return duringDraw(() => {
            return current.bodies[declaration.body]!.run({
              place: (row: unknown, input: unknown) => place(pane, row, input, basis),
              page: ports.page,
              work: read().work?.value ?? null,
              workBasis: basis,
              history,
              cells: {
                take: (id: string, key: unknown) => transitionCell("take", id, key),
                unsuggest: (id: string, key: unknown) => transitionCell("unsuggest", id, key),
                clear: (id: string, key: unknown) => transitionCell("clear", id, key),
              },
              recovery: route.data.work
                ? { state: recovery, startFresh, carryOver: salvage }
                : undefined,
              readings: Object.freeze(
                Object.fromEntries(declaration.draws.map((id) => [id, snapshots()[id]])),
              ),
              readingActions: Object.fromEntries(
                declaration.draws
                  .filter((id) => geometry.actions[id])
                  .map((id) => [id, geometry.actions[id]]),
              ),
              readCosts: Object.freeze({ ...geometry.costs }),
              visible: true,
              verbs: Object.fromEntries(
                ("allowed" in declaration.verbs
                  ? declaration.verbs.allowed
                  : declaration.verbs
                ).map((id: string) => [
                  id,
                  (input: unknown, editBasis?: InvocationToken) => {
                    if (route.data.verbs[id]?.kind === "work" && !editBasis)
                      throw Error("Work edit requires its rendered accepted basis");
                    return invoke(id, input, editBasis);
                  },
                ]),
              ),
            });
          });
        };

}
