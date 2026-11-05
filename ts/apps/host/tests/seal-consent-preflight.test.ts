import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionJournal } from "../src/action-journal.ts";
import { fixtureCommand, invokeFixtureCommand } from "./command-fixture.ts";
import { crossingOf } from "./callers.ts";
import { refused } from "../src/command-executor.ts";
import * as control from "../src/control.ts";

test("a typed stale-preview refusal reaches the receipt before consent opens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-seal-consent-"));
  const authorize = vi.spyOn(control, "authorizeCommand");
  try {
    const owner = new ActionJournal(join(dir, "journal.jsonl"), Date.now);
    const entry = fixtureCommand(
      [{ kind: "file", path: "C:/write" }],
      async () => null,
      async () => {
        throw Error("must not execute");
      },
    );
    const bind = entry.bind;
    entry.bind = async (ctx) => ({
      ...(await bind(ctx)),
      preflight: async () => {
        throw refused("Plan the current Work first", "preview.stale");
      },
    });
    await invokeFixtureCommand(
      owner,
      { id: "no-preview", key: "test.preflight", target: { kind: "host" }, input: {} },
      crossingOf("agent"),
      entry,
    );
    const receipt = await owner.wait("no-preview");
    expect(receipt).toMatchObject({
      notDispatched: true,
      refusal: { kind: "domain", code: "preview.stale" },
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(receipt.consentWindow).toBeUndefined();
  } finally {
    authorize.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
