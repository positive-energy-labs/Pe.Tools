import type { InvocationToken } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { MountContext } from "./admitted-context.ts";
export function createAdmittedBody<W extends Record<string, unknown>>(context: MountContext<W>) {
  const { route, read, resolve, ports, geometry: getGeometry, observers, duringDraw } = context;
  const geometry = getGeometry(),
    invocation = context.invocation(),
    historyOwner = context.history(),
    transitionCell = context.cellActions(),
    snapshots = context.readings().snapshots;

  const { workBasis, place, invoke } = invocation;
  const { history, recovery, startFresh, salvage } = historyOwner.public;
  return (pane: string) => {
    const current = resolve();
    if (!Object.hasOwn(route.data.panes, pane)) throw Error(`Unknown pane: ${pane}`);
    const declaration = route.data.panes[pane]!;
    const body = declaration.body;
    if (!observers.visible(pane) || !body) return null;
    const basis = workBasis();
    return duringDraw(() => {
      return current.bodies[body]!.run({
        place: (row: unknown, input: unknown) => place(pane, row, input, basis),
        page: ports.page,
        target: read().scope.identity.target,
        work: read().work?.value ?? null,
        workBasis: basis,
        history,
        cells: {
          clear: (id: string, key: unknown) => transitionCell.public.clearCell(id, key),
        },
        recovery: route.data.work ? { state: recovery, startFresh, carryOver: salvage } : undefined,
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
        fixture: context.input.fixture,
        verbs: Object.fromEntries(
          ("allowed" in declaration.verbs ? declaration.verbs.allowed : declaration.verbs).map(
            (id: string) => [
              id,
              (input: unknown, editBasis?: InvocationToken) => {
                const verb = route.data.verbs[id];
                if (verb?.kind === "work" && verb.target === undefined && !editBasis)
                  throw Error("Work edit requires its rendered accepted basis");
                return invoke(id, input, editBasis);
              },
            ],
          ),
        ),
      });
    });
  };
}
