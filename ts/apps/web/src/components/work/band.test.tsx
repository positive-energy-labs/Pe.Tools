// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  applyPatches,
  draftCellSchema,
  type CellLike,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { reviewTransitions, UnstageAll } from "./band";

afterEach(cleanup);

test.each(["edits", null])(
  "composer revert deletes keys under %s and preserves proposals",
  async (segment) => {
    const cells: Record<string, CellLike> = {
      edit: { edit: { value: 1 } },
      contested: { edit: { value: 2 }, suggestion: { value: 3 } },
      locked: { edit: { value: 4 } },
    };
    const cellMap = z.record(z.string(), draftCellSchema(z.number()));
    const schema = segment === null ? cellMap : z.object({ [segment]: cellMap });
    let envelope = {
      version: 1 as const,
      revision: 8,
      doc: schema.parse(segment === null ? cells : { [segment]: cells }),
    };
    const write = vi.fn(async (patches: RouteStatePatch[]) => {
      const result = applyPatches(
        { route: "band-test", title: "Band", description: "Revert", schema },
        envelope,
        "human",
        patches,
        8,
      );
      if (!result.ok) return { code: result.kind, message: result.error };
      envelope = result.envelope;
      return null;
    });
    const done = vi.fn();
    render(
      <UnstageAll
        wire={{
          segment,
          revision: 8,
          write,
          lockOf: (key) => (key === "locked" ? "locked" : null),
        }}
        cells={cells}
        keys={Object.keys(cells)}
        done={done}
        compact
      />,
    );
    const revert = screen.getByRole("button", { name: "Revert 2 edit" });
    fireEvent.click(revert);
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(revert);
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(write).toHaveBeenCalledWith(
      [
        { path: [...(segment === null ? [] : [segment]), "edit"] },
        { path: [...(segment === null ? [] : [segment]), "contested", "edit"] },
      ],
      8,
      { press: expect.any(String) },
    );
    const remaining = { contested: { suggestion: { value: 3 } }, locked: { edit: { value: 4 } } };
    expect(envelope.doc).toEqual(segment === null ? remaining : { [segment]: remaining });
  },
);

test("a single-cell clear deletes the cell instead of leaving an edit marker", async () => {
  const write = vi.fn(async () => null);
  const clear = reviewTransitions({ segment: "cells", revision: 4, write }, "one", {
    edit: { value: 1 },
  }).find((transition) => transition.kind === "clear")!;
  await clear.run();
  expect(write).toHaveBeenCalledWith([{ path: ["cells", "one"] }], 4);
});
