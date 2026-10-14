import { expect, test } from "vite-plus/test";
import type { Provider } from "@pe/agent-contracts";

import { loginLine } from "./providers";

const codex = (readiness: Provider["readiness"], probedAt: string | null = "t0"): Provider => ({
  id: "codex",
  harness: "codex",
  name: "Codex",
  auth: { kind: "subscription" },
  readiness,
  models: [],
  traits: [],
  probedAt,
});
const signedOut = { state: "refused", step: "signed-in", message: "not signed in" } as const;
const missing = { state: "refused", step: "installed", message: "not installed" } as const;

test("a sign-in press says what is happening until a probe has answered", () => {
  expect(loginLine(codex(signedOut), undefined)).toBeNull();
  expect(loginLine(codex(signedOut), { state: "opening" })).toEqual({
    kind: "busy",
    label: "Opening the Codex sign-in console",
  });
  expect(loginLine(codex(missing), { state: "opening" })?.label).toBe(
    "Opening the Codex installer console",
  );
  expect(loginLine(codex(signedOut), { state: "open", probedAt: "t0" })).toEqual({
    kind: "advisory",
    label: "Finish sign-in in the console that opened; this updates when it closes",
  });
  // The console closed and the host probed again: the row's own readiness speaks now.
  expect(loginLine(codex(signedOut, "t1"), { state: "open", probedAt: "t0" })).toBeNull();
  expect(loginLine(codex({ state: "ready" }, "t1"), { state: "open", probedAt: "t0" })).toBeNull();
  expect(loginLine(codex(signedOut), { state: "failed", message: "Could not open it" })).toEqual({
    kind: "error",
    label: "Could not open it",
  });
});
