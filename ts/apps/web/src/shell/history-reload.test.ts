import { test, expect } from "vite-plus/test";
import { bindWork } from "@pe/agent-contracts";
import { createWorkJournal } from "@pe/runtime/work-journal";
import { writeLabel } from "./work-writes";

test("durable human edits replay with Work field names and cell nouns", () => {
  const key = bindWork("history-labels", null, "one");
  const journal = createWorkJournal(key);
  journal.name((patches) =>
    writeLabel(patches, {
      workFields: { designFriction: { label: "design friction" } },
      cells: [{ segment: "equipmentFlows", noun: "unit flows", groupOf: (id) => [id] }],
    }),
  );
  for (const [index, path] of [
    ["designFriction"],
    ["equipmentFlows", "14577391", "edit"],
  ].entries())
    journal.accept({
      key,
      kind: "apply",
      by: "human",
      press: `p${index}`,
      step: `human:p${index}`,
      base: index,
      revision: index + 1,
      patches: [{ path, value: 950 }],
      inverse: [{ path }],
      undoable: true,
      replay: true,
    });
  expect(journal.read().moves.map((entry) => entry.label)).toEqual([
    "Edit design friction",
    "Edit unit flows",
  ]);
  expect(journal.read().undo.every((entry) => entry.by === "human" && !entry.superseded)).toBe(
    true,
  );
});

test("a route names steps already replayed by another Work reader", () => {
  const key = bindWork("late-history-names", null, "one");
  const journal = createWorkJournal(key);
  journal.accept({
    key,
    kind: "apply",
    by: "human",
    press: "p",
    base: 0,
    revision: 1,
    patches: [{ path: ["flow"], value: 950 }],
    inverse: [{ path: ["flow"] }],
    undoable: true,
  });
  journal.name((patches) => writeLabel(patches, { workFields: { flow: { label: "fan flow" } } }));
  expect(journal.read().moves[0]?.label).toBe("Edit fan flow");
});
