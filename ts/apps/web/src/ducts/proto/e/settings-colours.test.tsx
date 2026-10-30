// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { applyPatches, ductsRouteState } from "@pe/agent-contracts";
import { SystemColours } from "./settings";
import { FIRM_COLOURS } from "../../colours";
import type { LossesWork } from "../../work";

afterEach(cleanup);
test("the compact colour picker stages one validated Work palette and survives remount", async () => {
  let doc = ductsRouteState.schema.parse({});
  const write: LossesWork["write"] = vi.fn(async (patches) => {
    const result = applyPatches(
      ductsRouteState,
      { version: 1, revision: 0, doc },
      "human",
      patches,
      0,
    );
    if (!result.ok) throw Error("Palette patch was refused");
    doc = result.envelope.doc;
    return null;
  });
  const work: LossesWork = { doc, revision: 0, write };
  const view = render(<SystemColours work={work} />);
  expect(view.container.querySelectorAll('input[type="color"]')).toHaveLength(5);
  fireEvent.change(screen.getByLabelText("Supply air colour"), { target: { value: "#123456" } });
  await waitFor(() =>
    expect(doc.systemColours.edit?.value).toEqual({ ...FIRM_COLOURS, supply: "#123456" }),
  );
  view.unmount();
  render(<SystemColours work={{ ...work, doc }} />);
  expect((screen.getByLabelText("Supply air colour") as HTMLInputElement).value).toBe("#123456");
});

test("a refused palette write explains why instead of silently losing the edit", async () => {
  const work: LossesWork = {
    doc: null,
    revision: 0,
    write: async () => ({ code: "revision-conflict", message: "Work changed elsewhere" }),
  };
  render(<SystemColours work={work} />);
  fireEvent.change(screen.getByLabelText("Return air colour"), { target: { value: "#123456" } });
  await waitFor(() => expect(screen.getByText("Work changed elsewhere")).toBeTruthy());
});
