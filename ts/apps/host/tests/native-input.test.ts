import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { fixtureCommand } from "./command-fixture.ts";

test("persisted native input must still satisfy C# metadata before any effect callback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-native-input-"));
  try {
    const owner = new ActionJournal(join(directory, "journal.jsonl"));
    let effects = 0;
    await owner.invoke(
      { id: "schema", key: "test.native-schema", target: { kind: "host" }, input: {} },
      { caller: { kind: "human", via: "local" }, basis: null },
      fixtureCommand(
        [{ kind: "file", path: "C:/native-effect" }],
        async () => null,
        (execution) =>
          execution.step(
            "native",
            "family.apply",
            { unexpectedProperty: true },
            async () => ++effects,
          ),
      ),
    );
    expect(await owner.wait("schema")).toMatchObject({
      state: "failed",
      notDispatched: true,
      error: expect.stringContaining("Invalid native input"),
    });
    expect(effects).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
