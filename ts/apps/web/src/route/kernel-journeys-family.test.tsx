// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { familyDraftRouteState, workFingerprintSchema, type FamilyDraft, type WorkJournalDoor } from "@pe/agent-contracts";
import { module as family } from "../family/route";
import { TypedChrome } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import type { UseSource } from "../shell/source-contract";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { evaluate } from "../../../host/src/reads/evaluator";
import { reads as familyReads } from "../../../host/src/reads/family";

// Family cell behaviour on the typed mount: production FamilyBody over the real host read and a real
// RouteWorkspace Work store. Only the pod roster and file inputs are stubbed (empty).
const raw = JSON.stringify({
  family: { name: "Box" },
  parameters: {
    Width: { dataType: "Length", value: "24in", propertiesGroup: "Other" },
    Height: { dataType: "Length", value: "12in" },
  },
  types: { Standard: {}, Wide: { Width: "36in" } },
  connectors: { c1: { domain: "Duct", shape: "Round", on: "Front" } },
});

// The pane body is a lazy chunk; transform cost is paid once here, not inside a test timeout.
beforeAll(() => import("../family/mount"), 240_000);

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  cleanups.splice(0).reverse().forEach((c) => c());
});

async function mounted(cells: FamilyDraft["cells"], reading = raw) {
  const door = createFixtureWorkDoor(familyDraftRouteState, familyDraftRouteState.schema.parse({ reading, cells }));
  let accepted: { key: any; revision: number; doc: unknown } | undefined;
  let deliverValue: (() => void) | undefined;
  const first = Promise.withResolvers<void>();
  const work: WorkJournalDoor = { ...door, open: (scope) => ({ subscribe(deliver, end) {
    return door.open(scope).subscribe((state) => {
      if (state.kind === "ready") {
        accepted = { key: state.snapshot.handle.key, revision: state.snapshot.revision, doc: state.snapshot.value };
        first.resolve();
        deliverValue?.(); // every accepted Work revision republishes the read, as the host does
      }
      deliver(state);
    }, end);
  } }) };
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const publish = async () => {
      const at = accepted!;
      const value = await evaluate(familyReads.workspace, { ...(ctx.args as { member: null }), target: ctx.target }, {
        evaluation: crypto.randomUUID(), origin: { kind: "family-cells-journey" }, revision: () => at.revision,
        async take(name) {
          if (name === "work-scope") return at.key;
          if (name === "work") return { doc: at.doc, revision: at.revision };
          if (name === "local:pod.list") return { pods: [], unreadable: [] };
          throw Error(`Unexpected Family input: ${name}`);
        },
      });
      if (!ctx.signal.aborted) deliver({ kind: "complete", revision: at.revision + 1,
        value: { key: "family.workspace", generation: 0, version: at.revision + 1, state: "current", value } });
    };
    deliverValue = () => void publish().catch((error) => deliver({ kind: "failure", error }));
    void first.promise.then(deliverValue);
    return () => { deliverValue = undefined; };
  } };
  const mount = mounts.mountTypedRoute(family, {
    address: { read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} },
    // A fresh document target gives each test its own Work key, so the module-level edit buffer cannot leak between tests.
    target: { kind: "document", ref: { session: crypto.randomUUID(), openId: "family" } }, fixture: null, custody: { current: () => true }, memory: () => ({}),
    work: { address: null, open: null },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources: { "family.workspace": source } });
  function Journey() { return <TypedChrome mount={mount} document={<span>Family library</span>} />; }
  const router = createRouter({ routeTree: createRootRoute({ component: Journey }),
    history: createMemoryHistory({ initialEntries: ["/family"] }) });
  render(<RouterProvider router={router} />);
  cleanups.push(() => mount.dispose());
  await waitFor(() => expect(mount.value().current).toBe(true), { timeout: 10_000 });
  await screen.findByRole("textbox", { name: "Destination pod" }, { timeout: 10_000 });
  return { mount, doc: () => mount.owner()!.doc as FamilyDraft };
}

const cell = (row: string, column: string) => {
  const found = document.querySelector<HTMLElement>(`td[data-cell-id="${row}_${column}"]`);
  if (!found) throw Error(`No cell ${row}_${column}`);
  return found;
};
const clearButtons = (scope: HTMLElement) => within(scope).queryAllByRole("button", { name: "clear" });
const click = async (button: HTMLElement) => act(async () => fireEvent.click(button));
const typeInto = async (scope: HTMLElement, text: string) => {
  const input = scope.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.blur(input);
  });
};

test("Family History is inspection only: staged cells lose their verbs and an edit is refused", async () => {
  const f = await mounted({ "/types/Wide/Width": { edit: { value: "40in" } } });
  // Positive control: in the audit stage the same surfaces accept a verb and an edit.
  expect(clearButtons(cell("Width", "type:Wide"))).toHaveLength(1);
  await typeInto(cell("Height", "type:Standard"), "10in");
  await waitFor(() => expect(f.doc().cells["/types/Standard/Height"]?.edit?.value).toBe("10in"));
  const revision = f.mount.owner()!.revision;

  await act(async () => f.mount.page.pose({ stage: "history" }));
  expect(f.mount.page.read().stage).toBe("history");
  expect(clearButtons(cell("Width", "type:Wide"))).toHaveLength(0);
  await typeInto(cell("Height", "type:Wide"), "11in");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(f.doc().cells["/types/Wide/Height"]).toBeUndefined();
  expect(f.doc().cells["/types/Wide/Width"]?.edit?.value).toBe("40in");
  expect(f.mount.owner()!.revision).toBe(revision);
});

test.each([
  ["isInstance", false, "isInstance false"],
  ["formula", "Height * 2", "formula Height * 2"],
  ["propertiesGroup", "Dimensions", "propertiesGroup Dimensions"],
] as const)("%s belongs to the parameter identity column, not a type's value", async (property, value, words) => {
  const pointer = `/parameters/Width/${property}`;
  const f = await mounted({ [pointer]: { edit: { value } } });
  const identity = cell("Width", "param");
  expect(identity.textContent).toContain(words);
  for (const type of ["Standard", "Wide"]) expect(clearButtons(cell("Width", `type:${type}`))).toHaveLength(0);
  await click(clearButtons(identity)[0]!);
  await waitFor(() => expect(f.doc().cells[pointer]?.edit).toBeNull());
  expect(f.doc().cells["/parameters/Width/value"]).toBeUndefined();
});

test("clearing a proposed type value keeps the proposed parameter definition", async () => {
  const definition = { dataType: "Number", value: "2" };
  const f = await mounted({
    "/parameters/PE_Pressure": { edit: { value: definition } },
    "/types/Standard/PE_Pressure": { edit: { value: "4" } },
  });
  const typeCell = cell("PE_Pressure", "type:Standard");
  // The staged value is the cell's proposal (its tooltip names it), not the input's typed text.
  expect(typeCell.querySelector("[aria-description]")!.getAttribute("aria-description")).toContain("staged 4 here");
  await click(clearButtons(typeCell)[0]!);
  await waitFor(() => expect(f.doc().cells["/types/Standard/PE_Pressure"]?.edit).toBeNull());
  expect(f.doc().cells["/parameters/PE_Pressure"]).toEqual({ edit: { value: definition } });
});

test("a held connector property is drawn once and Keep writes its own property address", async () => {
  const f = await mounted({ "/connectors/c1/on": { edit: { value: "Back", by: "pea" } } });
  expect(document.querySelectorAll('[data-suggestion-id="/connectors/c1/on"]')).toHaveLength(1);
  try { await screen.findByRole("button", { name: "Keep connectors · c1 · on" }, { timeout: 4000 }); }
  catch (error) { (await import("node:fs")).writeFileSync(process.env.TEMP + "/famdom-conn.html", document.body.innerHTML); throw error; }
  await click(screen.getByRole("button", { name: "Keep connectors · c1 · on" }));
  await waitFor(() => expect(f.doc().cells["/connectors/c1/on"]?.edit?.by).not.toBe("pea"));
  expect(f.doc().cells["/connectors/c1/on"]?.edit?.value).toBe("Back");
  expect(f.doc().cells["/connectors/c1"]).toBeUndefined();
});

test("a malformed family reads 'no family header' and draws no editable rows", async () => {
  const f = await mounted({}, "{}");
  expect(screen.getByRole("alert").textContent).toContain("The document has no family header.");
  expect(document.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(f.doc().reading).toBe("{}");
  expect(f.doc().cells).toEqual({});
});
