// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { RegistryContext } from "@effect/atom-react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { subjectCode } from "@pe/agent-contracts/subject-ref";
import { module as families } from "../families/route";
import { route, scrollBody } from "../route/typed-route";
import { ElementMenu } from "../revit/element-menu";
import { appAtomRegistry } from "./owner";
import { TypedShell } from "./typed-shell";

afterEach(cleanup);
const type = subjectCode({ keyKind: "name", key: ["Fam", "Type"] });
const probe = route({
  key: "families", name: "Families", needs: "browser", directory: families.data.directory, fields: {},
  panes: { main: { title: "Types", purpose: "Inspect a type", body: "scroll",
    draw: () => scrollBody(<span data-subject={type}>Type</span>) } },
  layout: { kind: "pane", id: "main" },
});

async function openRoute() {
  const root = createRootRoute({ component: () => <><ElementMenu /><TypedShell module={probe}
    fingerprint={workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`)} /></> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/families"] }) });
  await router.load();
  render(<RegistryContext.Provider value={appAtomRegistry}><RouterProvider router={router} /></RegistryContext.Provider>);
  return screen.findByText("Type");
}

test("the typed shell puts its Findings route on the subject's DOM ancestry", async () => {
  const target = await openRoute();
  expect(target.closest("[data-findings-route]")?.getAttribute("data-findings-route")).toBe("families");
});

test("a type mounted through the typed shell offers Findings in the element menu", async () => {
  const target = await openRoute();
  fireEvent.contextMenu(target);
  fireEvent.click(await screen.findByRole("option", { name: "Findings" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByLabelText("finding text")).toBeTruthy();
});
