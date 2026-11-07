// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { RegistryContext } from "@effect/atom-react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { familyDraftRouteState, type FamilyDraft, type WorkKey } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { createGraphMount, type MountScope } from "#/shell/mount";
import { familyGraph } from "./graph";
import { familySources, familyWitnessCells } from "./sources";
import { familyBinding, familyCell } from "./actions";
import { FamilyProvider } from "./workspace";
import { useFamilyWorkspace } from "./workspace-context";
import { FamilyWorkspaceDocPane } from "./workspace-doc-pane";
import { FamilyWorkspaceAnatomy } from "./workspace-anatomy";
import { familyLockOf, type FamilyMount } from "./store";

const releases: (() => void)[] = [];
afterEach(() => {
  cleanup();
  releases
    .splice(0)
    .reverse()
    .forEach((release) => release());
  vi.restoreAllMocks();
});
const raw = JSON.stringify({
  family: { name: "Box" },
  parameters: {
    Width: { dataType: "Length", value: "24in", propertiesGroup: "Other" },
    Height: { dataType: "Length", value: "12in" },
  },
  types: { Standard: {}, Wide: { Width: "36in" } },
  connectors: { c1: { domain: "Duct", shape: "Round", on: "Front" } },
});

// Production columns and sidebar consume the same production provider, not a fabricated store.
function Cells() {
  const core = useFamilyWorkspace();
  return (
    <>
      <output aria-label="Family model error">{core.lane.parseError}</output>
      {core.rows.map((row) => (
        <section key={row.name} aria-label={row.name}>
          <div aria-label="identity">{core.identityColumn(core.tableState).cell!(row)}</div>
          <div aria-label="Standard">{core.typeColumn("Standard").cell!(row)}</div>
          <div aria-label="Wide">{core.typeColumn("Wide").cell!(row)}</div>
        </section>
      ))}
      <section aria-label="constituents">
        <FamilyWorkspaceAnatomy />
      </section>
      <section aria-label="inspector">
        <FamilyWorkspaceDocPane />
      </section>
    </>
  );
}
function Editor({ owner }: { owner: FamilyMount }) {
  useSyncExternalStore(owner.subscribe, owner.version, owner.version);
  return (
    <RegistryContext value={owner.registry}>
      <FamilyProvider owner={owner} cells={familyWitnessCells(owner)}>
        <Cells />
      </FamilyProvider>
    </RegistryContext>
  );
}
async function mounted(cells: FamilyDraft["cells"], reading = raw) {
  const document = { session: crypto.randomUUID(), openId: "family" };
  const key: WorkKey = { binding: "open", route: "family", target: null, open: document };
  // Only disk I/O is authored here. RouteWorkspace owns validation, revisions and transitions.
  let saved: unknown = {
    version: 1,
    schemaVersion: 1,
    revision: 0,
    doc: familyDraftRouteState.schema.parse({ reading, cells }),
    history: [],
  };
  const host = new RouteWorkspace({
    registrations: [{ spec: familyDraftRouteState }],
    store: {
      getState: async () => structuredClone(saved),
      setState: async ({ value }) => {
        saved = structuredClone(value);
      },
    },
  });
  let envelope = (await host.view(key, "family"))!;
  let scope: MountScope<FamilyDraft> = {
    target: { kind: "document", ref: document },
    work: {
      handle: { key, revision: envelope.revision },
      doc: familyDraftRouteState.schema.parse(envelope.doc),
    },
  };
  const listeners = new Set<() => void>();
  const owner = createGraphMount(
    familyGraph,
    {
      sources: familySources(),
      binding: familyBinding,
      cell: familyCell,
      getSnapshot: () => scope,
      subscribe: (notify) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
      write: async (requested, write) => {
        const result = await host.write(requested, "family", "human", write);
        if (result.ok) {
          envelope = (await host.read(key, "family"))!;
          scope = {
            ...scope,
            work: {
              handle: { key, revision: envelope.revision },
              doc: familyDraftRouteState.schema.parse(envelope.doc),
            },
          };
          listeners.forEach((notify) => notify());
        }
        return result;
      },
      subscribeAcceptedDeltas: (requested, accept) => host.observeAccepted(requested, accept),
    },
    { inspector: "param:Height" },
  );
  owner.connect();
  releases.push(() => owner.dispose());
  render(<Editor owner={owner} />);
  return {
    owner,
    host,
    key,
    doc: async () => (await host.read(key, "family"))!.doc as FamilyDraft,
  };
}
const verbs = (scope: HTMLElement) =>
  within(scope)
    .queryAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent)
    .filter((name) => name === "clear");
const typeCell = (row: string, type: string) =>
  within(screen.getByRole("region", { name: row })).getByLabelText(type);
const clear = async (scope: HTMLElement) => {
  await act(async () => fireEvent.click(within(scope).getByRole("button", { name: "clear" })));
};

test("table and inspector decisions persist distinct type and family addresses through the real store", async () => {
  const f = await mounted({
    "/types/Wide/Width": { edit: { value: "40in" } },
    "/parameters/Height/value": { edit: { value: "10in" } },
  });
  const table = typeCell("Width", "Wide");
  expect(verbs(table)).toEqual(["clear"]);
  await clear(table);
  await waitFor(async () => expect((await f.doc()).cells["/types/Wide/Width"]?.edit).toBeNull());
  const inspector = screen.getByRole("region", { name: "inspector" });
  const field = within(inspector).getByDisplayValue("10in").closest<HTMLElement>(".dl-cell")!;
  await clear(field.parentElement!);
  await waitFor(async () =>
    expect((await f.doc()).cells["/parameters/Height/value"]?.edit).toBeNull(),
  );
  expect((await f.doc()).reading).toBe(raw);
  expect(f.owner.snapshot().work?.handle.revision).toBe(2);
  expect(
    await f.owner
      .control("edit", {
        patches: [{ path: ["cells", "/types/Wide/Width", "edit"], value: { value: "stale" } }],
        expectedRevision: 0,
      })
      .run(),
  ).toMatchObject({
    state: "refused",
    refusal: { message: "Work changed; edit the current family cells" },
  });
  expect((await f.doc()).cells["/types/Wide/Width"]?.edit).toBeNull();
  expect(f.owner.snapshot().work?.handle.revision).toBe(2);
});

test("a missing parameter's proposed type value is editable and accepting it preserves its definition proposal", async () => {
  const f = await mounted({
    "/parameters/PE_Pressure": { edit: { value: { dataType: "Number", value: "2" } } },
    "/types/Standard/PE_Pressure": { edit: { value: "4" } },
  });
  const cell = typeCell("PE_Pressure", "Standard");
  expect(within(cell).getByDisplayValue("4")).toBeTruthy();
  await clear(cell);
  await waitFor(async () =>
    expect((await f.doc()).cells["/types/Standard/PE_Pressure"]?.edit).toBeNull(),
  );
  expect((await f.doc()).cells["/parameters/PE_Pressure"]).toEqual({
    edit: { value: { dataType: "Number", value: "2" } },
  });
});

test.each([
  ["isInstance", false, "isInstance false"],
  ["formula", "Height * 2", "formula Height * 2"],
  ["propertiesGroup", "Dimensions", "propertiesGroup Dimensions"],
] as const)(
  "%s belongs to the parameter identity, not a type's value",
  async (property, value, words) => {
    const pointer = `/parameters/Width/${property}`;
    const f = await mounted({ [pointer]: { edit: { value } } });
    const row = screen.getByRole("region", { name: "Width" });
    const identity = within(row).getByLabelText("identity");
    expect(within(identity).getByText(words)).toBeTruthy();
    expect(typeCell("Width", "Standard").querySelector("[data-body=proposed]")).toBeNull();
    await clear(identity);
    await waitFor(async () => expect((await f.doc()).cells[pointer]?.edit).toBeNull());
    expect((await f.doc()).cells["/parameters/Width/value"]).toBeUndefined();
  },
);

test("a held connector property is drawn once and acceptance writes its property address", async () => {
  const f = await mounted({ "/connectors/c1/on": { edit: { value: "Back" } } });
  const anatomy = screen.getByRole("region", { name: "constituents" });
  expect(within(anatomy).getAllByText("on Back")).toHaveLength(1);
  await clear(anatomy);
  await waitFor(async () => expect((await f.doc()).cells["/connectors/c1/on"]?.edit).toBeNull());
  expect((await f.doc()).cells["/connectors/c1"]).toBeUndefined();
});

test("history keeps the staged value read-only", async () => {
  const f = await mounted({ "/types/Wide/Width": { edit: { value: "40in" } } });
  await act(async () => f.owner.view.setPage({ stage: "history" }));
  expect(verbs(typeCell("Width", "Wide"))).toEqual([]);
  expect((await f.doc()).cells["/types/Wide/Width"]?.edit?.value).toBe("40in");
});

// A shared pointer may not resolve into a drawable parameter, so keep its boundary protection narrow.
test("shared parameter directives lock descendant cells without locking local definitions", () => {
  expect(
    familyLockOf({ parameters: { $preset: "@local/_params/width" } })("/parameters/Height/value"),
  ).toContain("shared source");
  expect(familyLockOf(JSON.parse(raw))("/parameters/Height/value")).toBeNull();
});

test("malformed family content stays inspectable without inventing editable parameter rows", async () => {
  const f = await mounted({}, "{}");
  expect(screen.getByLabelText("Family model error").textContent).toBe(
    "The document has no family header.",
  );
  expect(screen.queryByRole("region", { name: "Width" })).toBeNull();
  expect((await f.doc()).reading).toBe("{}");
  expect((await f.doc()).cells).toEqual({});
});
