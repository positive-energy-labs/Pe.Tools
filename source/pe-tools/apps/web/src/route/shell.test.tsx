// @vitest-environment jsdom
/**
 * The shell's obligations: an EMPTY manifest renders (name + lamp, nothing else), and an action
 * that refuses says why rather than running.
 */
import { type ReactNode } from "react";
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { z } from "zod";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { defineRoute, emptyManifest } from "./manifest";
import { RouteShell } from "./shell";
import { useRoute } from "./use-route";

afterEach(cleanup);

const wrap = async (node: ReactNode) => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return <RouterProvider router={router} />;
};

test("an empty manifest renders its name and the host lamp", async () => {
  render(await wrap(<RouteShell manifest={emptyManifest("blank", "Blank")} live={false} />));
  expect(screen.getByRole("heading", { name: "Blank" })).toBeTruthy();
  expect(screen.getByText(/host · offline/)).toBeTruthy();
});

test("an action that refuses says why instead of running", async () => {
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
  render(await wrap(<RouteShell manifest={manifest as never} live={false} />));
  const button = screen.getByRole("button", { name: /commit/ });
  expect(button.getAttribute("title")).toBe("nothing is staged · Mod+Enter");
  expect(button.textContent).not.toContain("Mod+Enter");
});

test("the shell runs the supplied workspace handle and shares its outcome and Page", async () => {
  const manifest = defineRoute({
    key: "shared-page",
    name: "Shared page",
    page: z.object({ panel: z.boolean().default(false) }),
    actions: {
      review: {
        label: "review",
        says: "Open the workspace review",
        needs: "host",
        actor: "any",
        input: z.void() as never,
        dirties: [],
        ready: () => null,
        run: async (ctx) => ctx.setPage({ panel: true }),
      },
    },
  });
  function Workspace() {
    const handle = useRoute(manifest);
    return (
      <RouteShell manifest={manifest} handle={handle} live={false}>
        <div>{handle.page[0].panel ? "Workspace review open" : "Workspace review closed"}</div>
        <div>{handle.outcome?.label ?? "No workspace outcome"}</div>
      </RouteShell>
    );
  }
  render(await wrap(<Workspace />));
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  expect(await screen.findByText("Workspace review open")).toBeTruthy();
  expect(await screen.findByText("review", { selector: "div" })).toBeTruthy();
});
