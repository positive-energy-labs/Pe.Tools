import { expect, test } from "vite-plus/test";
import type { HostAdmittedRoute } from "../../../../packages/agent-contracts/src/host-route-admission";
import { createRouteShell } from "./admitted-mount";

function hostCannotMount(host: HostAdmittedRoute, shell: ReturnType<typeof createRouteShell>) {
  // @ts-expect-error Host admission cannot authenticate a web mount.
  shell.mount(host, { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} });
}

test("host admission has a distinct nominal authority", () => {
  expect(typeof hostCannotMount).toBe("function");
});
