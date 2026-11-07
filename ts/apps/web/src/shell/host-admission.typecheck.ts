import { placeInput } from "./typed-place.test-support";
import type { HostAdmittedRoute } from "../../../../packages/agent-contracts/src/host-route-admission";
import { createRouteShell } from "./admitted-mount";

function hostCannotMount(host: HostAdmittedRoute, shell: ReturnType<typeof createRouteShell>) {
  shell.mount(
    // @ts-expect-error Host admission cannot authenticate a web mount.
    host,
    placeInput({ read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} }),
  );
}

void hostCannotMount;

function inputIsRequired(
  route: Parameters<ReturnType<typeof createRouteShell>["mount"]>[0],
  shell: ReturnType<typeof createRouteShell>,
) {
  // @ts-expect-error An address alone cannot supply Place custody or target authority.
  shell.mount(route, { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} });
}
void inputIsRequired;
