// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Pane } from "@pe/kit/lang/pane";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Switcher } from "@pe/kit/lang/switcher";
import { readTeaching } from "@pe/kit/lang/teach";
import { useTeaching } from "@pe/kit/lang/use-teach";
import { KeyScope, useScopeKeys } from "@pe/kit/keys";
import { QueryBox } from "@pe/kit/table/query";
import { HelpWorld } from "#/route/help";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(readTeaching()).toEqual([]);
});
const noop = () => {};
const options = [
  { value: "model", label: "model", title: "Geometry" },
  { value: "plan", label: "plan", title: "Plan view" },
];
function ListFixture({ mode = "model", extra = false }: { mode?: string; extra?: boolean }) {
  const list = useList({
    items: Array.from({ length: 8 }, (_, i) => ({ key: String(i), name: `Duct ${i}` })),
    keyOf: (x) => x.key,
    search: (x) => ({ text: [x.name] }),
    fields: {
      name: { label: "Name", kind: "text", read: (x) => x.name },
      ...(extra ? { size: { label: "Size", kind: "number" as const, read: () => 10 } } : {}),
    },
  });
  return (
    <Pane
      id="systems"
      title="Systems"
      floaters={[
        {
          key: "schematic",
          label: "schematic",
          place: "br",
          open: false,
          onOpenChange: noop,
          render: () => null,
        },
      ]}
    >
      <Switcher ariaLabel="picture" options={options} value={mode} onChange={noop} />
      <ListView
        list={list}
        aria-label="systems"
        row={(x) => ({ label: x.name })}
        empty={{ message: "Empty", exit: "Load" }}
      />
    </Pane>
  );
}
function Tutorial() {
  return <HelpWorld facts={useTeaching()} />;
}

test("ListView publishes real fields; the open tutorial follows modes and fields, and unmount withdraws all facts", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 400, 600),
  );
  const page = (mode: string, extra: boolean) => (
    <StrictMode>
      <ListFixture mode={mode} extra={extra} />
      <Pane title="Untaught">body</Pane>
      <Tutorial />
    </StrictMode>
  );
  const view = render(page("model", false));
  const search = readTeaching().find((f) => f.kind === "search" && f.label === "Search systems");
  expect(search).toMatchObject({ kind: "search", fields: [{ label: "Name", operators: ["is"] }] });
  const tutorial = screen
    .getAllByRole("region", { name: "Systems" })
    .find((node) => !node.hasAttribute("data-slot"))!;
  expect(tutorial.querySelector(".dl-leader-diagram")?.textContent).toContain("Name");
  expect(within(tutorial).getByText("model · active")).toBeTruthy();
  expect(within(tutorial).getByLabelText("schematic").textContent).toContain("available");
  expect(screen.getByRole("heading", { name: "2 Untaught" })).toBeTruthy();
  view.rerender(page("plan", true));
  expect(within(tutorial).getByText("plan · active")).toBeTruthy();
  expect(tutorial.querySelector(".dl-leader-diagram")?.textContent).toContain("Size");
  view.unmount();
  expect(readTeaching()).toEqual([]);
});

test("hidden scopes withdraw keys, modes and regions; key refusal changes remain live", () => {
  function Keys({ refused }: { refused: boolean }) {
    useScopeKeys([
      { hotkey: "O", label: "projection", refusal: refused ? "capturing" : null, callback: noop },
    ]);
    return null;
  }
  const page = (hidden: boolean, refused: boolean) => (
    <>
      <KeyScope id="stage" hidden={hidden}>
        <Pane title="Picture">
          <Keys refused={refused} />
          <Switcher ariaLabel="picture" options={options} value="model" onChange={noop} />
        </Pane>
      </KeyScope>
      <Tutorial />
    </>
  );
  const view = render(page(false, false));
  expect(
    readTeaching().some((f) => f.kind === "keys" && f.items.some((k) => k.label === "projection")),
  ).toBe(true);
  view.rerender(page(false, true));
  expect(screen.getByText(/refuses now: capturing/)).toBeTruthy();
  expect(
    readTeaching()
      .filter((f) => f.kind === "keys")
      .flatMap((f) => (f.kind === "keys" ? f.items : []))
      .some((k) => k.refusal === "capturing"),
  ).toBe(true);
  view.rerender(page(true, true));
  expect(readTeaching()).toEqual([]);
});

test("table search teaches only its real fields and operators and removes them on unmount", () => {
  render(
    <QueryBox
      vocabulary={{
        fields: [
          { label: "Length", kind: "number" },
          { label: "Name", kind: "text" },
          { label: "Drawing" },
        ],
        rules: [],
        count: () => 0,
        values: () => [],
      }}
      state={{ query: "", sorts: [] }}
      onStateChange={noop}
      draft=""
      onDraft={noop}
    />,
  );
  const search = readTeaching().find((f) => f.kind === "search");
  expect(search?.kind === "search" && search.fields.map((f) => f.label)).toEqual([
    "Length",
    "Name",
  ]);
  expect(search?.kind === "search" && search.fields[0]?.operators).toContain(">");
  cleanup();
  expect(readTeaching()).toEqual([]);
});
