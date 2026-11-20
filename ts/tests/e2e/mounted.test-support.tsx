/**
 * One mounted route of a product, for the journeys a product keeps in its `web/journeys/`: a
 * product folder never imports an app, so the app parts those journeys need come through here.
 * The command door is recorded; a product proves its command path in the host's own tests.
 * Run: vp test --config tests/e2e/product-journeys.config.ts
 */
import { useSyncExternalStore, type ReactNode } from "react";
import type { TypedMount } from "../../apps/web/src/shell/typed-mount";

export { mounted, path, ref, type Native } from "../../apps/web/src/shell/mounted-journey.test-support";
export { planned } from "../../apps/web/src/shell/typed-mount";

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
  return mount.draw(pane as never, children as never) as ReactNode;
}
