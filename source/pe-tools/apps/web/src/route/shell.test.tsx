// @vitest-environment jsdom
/**
 * The shell's two obligations: an EMPTY manifest renders (name + lamp, nothing else), and a chord
 * whose action refuses surfaces the refusal sentence rather than swallowing it.
 */
import { type ReactNode } from "react";
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { z } from "zod";

import { defineRoute, emptyManifest } from "./manifest";
import { RouteShell } from "./shell";

// The route handle subscribes the target inventory over SSE; jsdom has no EventSource and the
// shell's two obligations do not depend on it, so it is a stub that never opens anything.
class DeadSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = DeadSource;

afterEach(cleanup);

const wrap = (node: ReactNode) => node;

test("an empty manifest renders its name and the host lamp", () => {
  render(wrap(<RouteShell manifest={emptyManifest("blank", "Blank")} live={false} />));
  expect(screen.getByRole("heading", { name: "Blank" })).toBeTruthy();
  expect(screen.getByText(/host · offline/)).toBeTruthy();
});

test("an action that refuses says why instead of running", () => {
  const manifest = defineRoute({
    key: "refuser",
    name: "Refuser",
    actions: {
      commit: {
        label: "commit",
        says: "write the staged rows",
        needs: "host",
        actor: "any",
        input: z.undefined() as never,
        dirties: [],
        chord: "Mod+Enter",
        ready: () => "nothing is staged",
        run: async () => {
          throw new Error("must not run");
        },
      },
    },
  });
  render(wrap(<RouteShell manifest={manifest as never} live={false} />));
  fireEvent.click(screen.getByRole("button", { name: /Refuser/ }));
  expect(screen.getByRole("button", { name: /commit/ }).getAttribute("title")).toBe(
    "nothing is staged",
  );
});
