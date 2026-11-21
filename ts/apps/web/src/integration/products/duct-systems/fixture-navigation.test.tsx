// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { module as ducts } from "../../../../../../products/duct-systems/web/route.ts";
import { ductsLink, systemCode } from "@pe/ducts-web/identity";
import { networkFixtures } from "@pe/ducts-web/network-fixtures";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { uniqueIdSchema } from "@pe/agent-contracts/subject-ref";
import { mountTypedRoute, typedSubjectDoor } from "../../../shell/typed-mount.ts";
import { TypedChrome } from "../../../shell/typed-shell.tsx";
import { StandaloneBand } from "../../../shell/band.test-support.tsx";

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes.splice(0).forEach((close) => close());
  vi.unstubAllGlobals();
});
async function arrive(href: string, memory: Record<string, unknown> = {}) {
  expect(Object.values(ducts.spec.panes).filter((pane) => pane.kernel === "picture")).toHaveLength(
    1,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await import("../../../../../../products/duct-systems/web/src/screen/screen.tsx");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Fixture called the host");
    }),
  );
  expect(ducts.spec.picture).toBeDefined();
  expect(ducts.spec.panes["e-picture"]).toMatchObject({ kernel: "picture", body: "fill" });
  const url = new URL(href, "http://pe.local");
  const mount = mountTypedRoute(
    ducts,
    {
      fixture: url.searchParams.get("fixture"),
      target: { kind: "document", ref: { session: "fixture", openId: "clinic" } },
      work: { address: null, open: { session: "fixture", openId: "clinic" } },
      address: {
        read: () => url.searchParams,
        write: (search) => {
          url.search = search.toString();
        },
        subscribe: () => () => {},
      },
      memory: () => memory,
      custody: { current: () => true },
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
  );
  closes.push(() => mount.dispose());
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <StandaloneBand>
          <TypedChrome mount={mount} document={<span>Fixture</span>} />
        </StandaloneBand>
      ),
    }),
    history: createMemoryHistory({ initialEntries: [href] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Duct settings" });
  expect(document.body.textContent).not.toContain("Missing fixture");
  expect(document.body.textContent).not.toContain("provide is not a function");
  return { mount, url };
}
test.each(Object.keys(networkFixtures))("/ducts resolves registered fixture %s", async (name) => {
  await arrive(`/ducts?fixture=${name}`);
});
test("MUAS-1 scene fix href reaches a rendering ducts mount", async () => {
  await arrive(
    ductsLink(
      { uniqueId: uniqueIdSchema.parse("scene:14577391"), portIndex: 2 },
      { fixture: "scene" },
    ),
  );
});

const repairPort = { uniqueId: uniqueIdSchema.parse("navigation:10052051"), portIndex: 1 };
test("a fan link replaces remembered systems and Clear closes the fan scope", async () => {
  const fan = repairPort;
  const { mount, url } = await arrive(ductsLink(fan, { fixture: "navigation" }), {
    system: { kind: "ids", ids: [systemCode("SA Office")] },
  });
  expect(mount.page.read()).toMatchObject({ fan, system: { kind: "ids", ids: [] } });
  fireEvent.click(screen.getByRole("button", { name: "Clear systems" }));
  expect(mount.page.read()).toMatchObject({ fan: null, system: { kind: "ids", ids: [] } });
  expect(url.searchParams.get("fan")).toBe("null");
  expect(await screen.findByText("Choose a system to see its picture.")).toBeTruthy();
  expect(await screen.findByText("Choose a system to see its rulings.")).toBeTruthy();
});

test("choosing a system writes both scope fields together before Clear", async () => {
  const { mount, url } = await arrive(ductsLink(repairPort, { fixture: "navigation" }));
  const ids = [systemCode("SA Office")];
  act(() => {
    typedSubjectDoor(mount)?.select(ids);
    expect(url.searchParams.get("fan")).toBe("null");
    expect(JSON.parse(url.searchParams.get("system") ?? "null")).toMatchObject({
      kind: "ids",
      ids,
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "Clear systems" }));
  expect(mount.page.read()).toMatchObject({ fan: null, system: { kind: "ids", ids: [] } });
  expect(await screen.findByText("Choose a system to see its picture.")).toBeTruthy();
  expect(await screen.findByText("Choose a system to see its rulings.")).toBeTruthy();
});
