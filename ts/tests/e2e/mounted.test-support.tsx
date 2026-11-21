/**
 * One mounted route of a product, for the journeys a product keeps in its `web/journeys/`: a
 * product folder never imports an app, so the app parts those journeys need come through here.
 * The command door is recorded; a product proves its command path in the host's own tests.
 * Run: vp test --config tests/e2e/product-journeys.config.ts
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { SheetPane } from "../../apps/web/src/route/slots/sheet/pane";
import { typedSubjectDoor, type TypedMount } from "../../apps/web/src/shell/typed-mount";
import { SubjectDoor } from "@pe/web-kernel/shell/subject";

export { mounted, path, type Native } from "../../apps/web/src/shell/mounted-journey.test-support";
export { hostedRouteAddress } from "../../apps/web/src/workbench/hosted-route";
export { planned, typedSubjectDoor } from "../../apps/web/src/shell/typed-mount";
// The recorded Chadds duct walk the fixture host answers duct reads with.
export { roster, snapshot } from "../../apps/host/tests/host-read-graph.test-support";
export {
  targetChange,
  backRestores,
  pin,
  targetJourney,
  targetPaths,
  type JourneyDoc,
  type TargetProduct,
} from "../../apps/web/src/shell/target-journey.test-support";

/** One pane of the mounted route, drawn again on every change of the mount. */
export function Pane({
  mount,
  pane,
  children,
}: {
  mount: TypedMount;
  pane: string;
  children: (ctx: any) => ReactNode;
}) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  // The shell hands every pane the subject door: a roster opens subjects only through it.
  return (
    <SubjectDoor value={typedSubjectDoor(mount)}>
      {mount.draw(pane as never, children as never) as ReactNode}
    </SubjectDoor>
  );
}

/** The kernel's sheet pane of the mounted route, as the shell draws it from the route's sheet slot. */
export function Sheet({ mount, pane }: { mount: TypedMount; pane: string }) {
  const slot = mount.spec.sheet;
  if (!slot) throw Error(`Route ${mount.spec.key} declares no sheet`);
  return (
    <Pane mount={mount} pane={pane}>
      {(ctx) => <SheetPane ctx={{ draw: ctx, slot, field: mount.spec.subject?.field }} />}
    </Pane>
  );
}
