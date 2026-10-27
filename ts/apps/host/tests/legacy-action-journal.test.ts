import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { fixtureCommand } from "./command-fixture.ts";

test("the v5 reader preserves original bytes, facts and uncertainty without authorizing new execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-v5-import-"));
  try {
    const path = join(dir, "journal.jsonl");
    const id = "old-action",
      actionId = randomUUID(),
      requestId = randomUUID();
    const original = {
      id,
      kind: "workflow",
      key: "historical.native",
      caller: { kind: "human", via: "local" },
      basis: { kind: "human" },
      origin: { caller: { kind: "human", via: "local" }, run: null, root: null },
      footprint: [{ kind: "file", path: "C:/original/output" }],
      frozen: { source: "\r\nexact\r\n", revision: 13 },
      consent: null,
      destination: { kind: "host" },
      request: { value: 1 },
      bases: { fileVersion: "original-sha" },
      steps: [
        {
          id: randomUUID(),
          key: "historical.native",
          kind: "native",
          input: { exact: "bytes" },
          state: "running",
          dispatchedAt: "2026-10-26T00:00:01Z",
        },
      ],
      preparation: {
        state: "ready",
        value: {
          process: { pid: 45, processStartUtc: "2026-10-26T00:00:00Z", executable: "C:/Revit.exe" },
          source: "old prepared bytes",
        },
      },
      recovery: [],
      publication: { state: "unrequested" },
      startedAt: "2026-10-26T00:00:00Z",
      state: "running",
    };
    const bytes = Buffer.from(
      [
        JSON.stringify({ version: 5 }),
        JSON.stringify({ mapping: [JSON.stringify(["action", id]), actionId] }),
        JSON.stringify({ mapping: [JSON.stringify(["action-request", id]), requestId] }),
        JSON.stringify({
          receipt: {
            schema: 1,
            id: randomUUID(),
            revision: 1,
            at: original.startedAt,
            stamp: null,
            join: { actionId, requestId },
            body: { kind: "action", value: original },
          },
        }),
        "",
      ].join("\r\n"),
    );
    await writeFile(path, bytes);
    const owner = new ActionJournal(path);
    const [row] = await owner.list(undefined, id);
    expect(row).toMatchObject({
      state: "unknown",
      input: { value: 1 },
      target: { kind: "host" },
      prepared: original.preparation,
      effects: original.footprint,
      refusal: { code: "historical-schema" },
      steps: [{ state: "unknown", dispatchedAt: original.steps[0]!.dispatchedAt }],
    });
    const provenance = row!.recovery.at(-1)!.evidence as { archive: string; sha256: string };
    expect(await readFile(provenance.archive)).toEqual(bytes);
    expect(provenance.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect((await readFile(path, "utf8")).split("\n")[0]).toBe('{"version":6}');
    expect((await new ActionJournal(path).list(undefined, id))[0]).toEqual(row);
    let executions = 0;
    await expect(
      owner.invoke(
        { id, key: row!.key, target: row!.target, input: row!.input },
        { caller: row!.caller, basis: row!.basis },
        fixtureCommand(
          [],
          async () => null,
          async () => ++executions,
        ),
        true,
      ),
    ).rejects.toThrow("Historical schema");
    expect(executions).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
