// @vitest-environment jsdom
/** Ask A: a stale cell reads A · C · B, and the aggregate fans out the cells' own answers. */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RouteStatePatch, ScheduleGridDocument } from "@pe/agent-contracts";

import { StaleResolve } from "./stale-resolve";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

const doc = (cells: ScheduleGridDocument["cells"], stale: { key: string; was: string }[]) =>
  ({ basis: { captureId: "c", stale }, cells }) as ScheduleGridDocument;
const now: Record<string, string> = { "1::2": "120 VA", "2::2": "90 VA", "3::2": "70 VA" };

const mount = (d: ScheduleGridDocument) => {
  const calls: (["write", RouteStatePatch[]] | ["push"])[] = [];
  const at = (revision: number) => (
    <StaleResolve
      doc={d}
      current={(key) => now[key] ?? null}
      revision={revision}
      write={async (patches) => {
        calls.push(["write", patches]);
        return null;
      }}
      push={async () => {
        calls.push(["push"]);
      }}
      unread={0}
      readAgain={async () => {}}
    />
  );
  const { rerender } = render(at(4));
  return Object.assign(calls, { landed: () => rerender(at(5)) });
};

test("the stale cell reads what you reviewed, what Revit holds now, and yours", () => {
  mount(doc({ "1::2": { staged: { value: "150 VA" } } }, [{ key: "1::2", was: "100 VA" }]));
  const cell = within(screen.getByRole("list", { name: "changed in Revit" })).getByRole("listitem");
  expect(cell.textContent).toMatch(/you reviewed 100 VA · Revit now 120 VA · yours 150 VA/);
});

test("Overwrite 1 re-stages that key, then pushes", async () => {
  const calls = mount(
    doc({ "1::2": { staged: { value: "150 VA" } } }, [{ key: "1::2", was: "100 VA" }]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Overwrite 1 changed value" }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  // The push waits for the re-stage's revision: the push admits the Work the page holds.
  expect(calls).toHaveLength(1);
  calls.landed();
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect([...calls]).toEqual([
    ["write", [{ path: ["cells", "1::2", "staged"], value: { value: "150 VA" } }]],
    ["push"],
  ]);
});

test("Keep Revit's 2 unstages both and pushes nothing", async () => {
  const calls = mount(
    doc({ "1::2": { staged: { value: "150 VA" } }, "2::2": { staged: { value: "95 VA" } } }, [
      { key: "1::2", was: "100 VA" },
      { key: "2::2", was: "80 VA" },
    ]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep Revit's 2 values" }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  const [kind, patches] = calls[0] as ["write", RouteStatePatch[]];
  expect(kind).toBe("write");
  expect(patches.map((p) => [p.path, p.value])).toEqual([
    [["cells", "1::2", "staged"], null],
    [["cells", "2::2", "staged"], null],
  ]);
});

test("a contested cell (Pea proposed beside it) is skipped and counted", async () => {
  const calls = mount(
    doc(
      {
        "1::2": { staged: { value: "150 VA" } },
        "3::2": { staged: { value: "75 VA" }, proposal: { value: "72 VA" } },
      },
      [
        { key: "1::2", was: "100 VA" },
        { key: "3::2", was: "60 VA" },
      ],
    ),
  );
  screen.getByText("skipped 1 (Pea proposed)");
  fireEvent.click(screen.getByRole("button", { name: "Keep Revit's 1 value" }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0]![1] as RouteStatePatch[]).map((p) => p.path[1])).toEqual(["1::2"]);
});

test("a stale refusal with no readback offers read again, never the overwrite", () => {
  const readAgain = vi.fn(async () => {});
  render(
    <StaleResolve
      doc={doc({ "1::2": { staged: { value: "150 VA" } } }, [])}
      current={() => null}
      revision={4}
      write={async () => null}
      push={async () => {}}
      unread={1}
      readAgain={readAgain}
    />,
  );
  expect(screen.queryByRole("button", { name: /Overwrite/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "read again" }));
  expect(readAgain).toHaveBeenCalledOnce();
});
