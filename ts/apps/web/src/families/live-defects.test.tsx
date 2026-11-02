// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { familyCellKey, showFamilyCell, showCellValue } from "@pe/agent-contracts";
import { Ladder } from "#/route/ladder";
import { createFixtureMount } from "#/shell/fixture";
import { familiesGraph } from "./graph";
import { familiesBinding } from "./actions";
import { readFamiliesCapture } from "../../../../packages/mcps/src/shared/families-client";

vi.mock("@pe/runtime/context", () => import("../../../../packages/runtime/src/invocation-context.browser"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("Families fixture edits share kernel undo/redo without calling the host", async () => {
  const fetch = vi.fn(() => {
    throw Error("unexpected host call");
  });
  vi.stubGlobal("fetch", fetch);
  const owner = await createFixtureMount(familiesGraph, "audit", { binding: familiesBinding });
  const disconnect = owner.connect();
  const release = owner.readings.mount(Object.keys(familiesGraph.readings));
  const key = familyCellKey({ familyName: "Box", typeName: "Small", parameter: "Height" });
  try {
    const result = await owner
      .control("edit", {
        expectedRevision: owner.snapshot().work!.handle.revision,
        patches: [
          {
            path: ["cells", key, "edit"],
            value: {
              value: {
                value: "1.6666666666666665",
                unit: "Feet and fractional inches",
                display: "1' - 8\"",
                storageType: "Double",
              },
            },
          },
        ],
      })
      .run();
    expect(result.state).toBe("done");
    expect(showFamilyCell(owner.snapshot().work!.doc.cells[key]!.edit!.value)).toBe("1' - 8\"");
    expect(await owner.restore("undo")).toMatchObject({ ok: true });
    expect(owner.snapshot().work!.doc.cells[key]?.edit).toBeUndefined();
    expect(await owner.restore("redo")).toMatchObject({ ok: true });
    expect(showFamilyCell(owner.snapshot().work!.doc.cells[key]!.edit!.value)).toBe("1' - 8\"");
    expect(
      showCellValue({
        value: "1.6666666666666665",
        unit: "Feet and fractional inches",
        display: "1' - 8\"",
      }),
    ).toBe("1' - 8\"");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    release();
    disconnect();
    owner.dispose();
  }
});

test("multi-pick ladder stays open for repeated choices and only narrows without toggling", async () => {
  function Picker() {
    const [picked, setPicked] = useState(["A", "B"]);
    return (
      <Ladder
        levels={[
          {
            key: "family",
            label: picked.join(", ") || "none",
            placeholder: "choose families",
            multi: true,
            options: ["A", "B"].map((id) => ({ id, label: id })),
            picked: (id) => picked.includes(id),
            pick: (id) =>
              setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]),
            only: (id) => setPicked([id]),
          },
        ]}
      />
    );
  }
  render(<Picker />);
  fireEvent.click(screen.getByRole("button", { name: "Choose family" }));
  fireEvent.click(await screen.findByRole("option", { name: /A/ }));
  expect(screen.getByRole("option", { name: /B/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Only A" }));
  expect(screen.getByRole("button", { name: "Choose family" }).textContent).toBe("A");
  expect(screen.getByRole("option", { name: /B/ })).toBeTruthy();
});

test("Families read transport carries this checkout runtime owner", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ cancelled: true }),
  );
  vi.stubGlobal("fetch", fetch);
  await readFamiliesCapture(
    "families.cancel-read",
    { readId: crypto.randomUUID() },
    { binding: "workspace", route: "families", target: null, work: "test" },
    { session: "one", openId: "doc" },
  );
  const init = fetch.mock.calls[0]![1] as RequestInit;
  expect(new Headers(init.headers).get("x-pe-runtime-service")).toBe(
    import.meta.env.PE_RUNTIME_SERVICE,
  );
});
