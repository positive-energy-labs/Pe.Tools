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
  "batch clear under %s clears either author and preserves locks",
  async (segment) => {
    const cells: Record<string, CellLike> = {
      edit: { edit: { value: 1, by: "pea" } },
      contested: { edit: { value: 2 } },
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
    // One press is one undoable journal step; no arming.
    const revert = screen.getByRole("button", { name: "Revert 2 edits" });
    fireEvent.click(revert);
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(write).toHaveBeenCalledWith(
      [
        { path: [...(segment === null ? [] : [segment]), "edit", "edit"], value: null },
        { path: [...(segment === null ? [] : [segment]), "contested", "edit"], value: null },
      ],
      8,
    );
    const remaining = {
      edit: { edit: null },
      contested: { edit: null },
      locked: { edit: { value: 4 } },
    };
    expect(envelope.doc).toEqual(segment === null ? remaining : { [segment]: remaining });
  },
);

test("inline clear writes the same staged path as batch clear", async () => {
  const write = vi.fn(async () => null);
  const clear = reviewTransitions({ segment: "cells", revision: 4, write }, "one", {
    edit: { value: 1 },
  }).find((transition) => transition.kind === "clear")!;
  await clear.run();
  expect(write).toHaveBeenCalledWith([{ path: ["cells", "one", "edit"], value: null }], 4);
});
