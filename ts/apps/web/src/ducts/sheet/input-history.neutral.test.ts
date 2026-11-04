import { expect, test } from "vite-plus/test";
import { bindWork, type WorkWriteAck } from "@pe/agent-contracts";
import { createWorkJournal } from "#/shell/journal";
import { writeLabel } from "#/shell/work-writes";
import { ductsData } from "../neutral";
import { editLabel, presentInputHistory } from "./input-history.neutral";

test("staging the write scope is named in History and never shown in Inputs", () => {
  const key = bindWork("ducts", null, "inputs-internal");
  const journal = createWorkJournal(key);
  journal.name((patches) =>
    writeLabel(patches, { workFields: { writeIntent: ductsData.workFields.writeIntent } }),
  );
  const ack = (revision: number, path: string[], press: string): WorkWriteAck => ({
    key,
    kind: "apply",
    by: "human",
    press,
    base: revision - 1,
    revision,
    patches: [{ path, value: 1 }],
    inverse: [{ path }],
    undoable: true,
    replay: true,
  });
  journal.accept(ack(1, ["flows", "12"], "a"));
  const entries = () =>
    journal.entries() as Parameters<typeof presentInputHistory>[0];
  expect(presentInputHistory(entries(), null).last?.label).not.toMatch(/\./);
  journal.accept(ack(2, ["writeIntent", "edit"], "b"));
  const read = journal.read();
  expect(read.undo.at(-1)).toMatchObject({ label: "Edit write scope", internal: true });
  expect(read.moves.at(-1)).toMatchObject({ label: "Edit write scope", internal: true });
  expect(presentInputHistory(entries(), null).last).toBeNull();
});

test("a criteria edit is named in words, never by its key", () => {
  expect(editLabel({ criteria: { allowanceInWg: { supply: 0.1 } } } as never, () => null)).toBe(
    "criteria allowance",
  );
});

test("reverting a value keeps Revert in History and its undo description", () => {
  const label = editLabel({ componentDrops: { "7": null } }, () => "DS-1");
  expect(label).toBe("Revert part drop DS-1");
  const entries = [
    { id: "revert", press: "revert", label, by: "human", at: 1, state: "undone", detail: "none" },
  ] as const;
  expect(presentInputHistory(entries, null).last).toEqual({
    label: "undid Revert part drop DS-1",
    words: "",
  });
});
