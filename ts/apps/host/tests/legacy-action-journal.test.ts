import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { fixtureCommand, registerFixtureCommand } from "./command-fixture.ts";

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
    expect((await readFile(path, "utf8")).split("\n")[0]).toBe('{"version":7}');
    expect((await new ActionJournal(path).list(undefined, id))[0]).toEqual(row);
    let executions = 0;
    registerFixtureCommand(
      owner,
      row!.key,
      fixtureCommand(
        [],
        async () => null,
        async () => ++executions,
      ),
    );
    await expect(owner.resume(id, { caller: row!.caller, basis: row!.basis })).rejects.toThrow(
      "Historical schema",
    );
    expect(executions).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each([4, 6])(
  "v%s imports retain terminal outcomes, uncertain reservations and the exact archive",
  async (version) => {
    const dir = await mkdtemp(join(tmpdir(), `pe-v${version}-import-`));
    try {
      const path = join(dir, "journal.jsonl");
      const claim = { kind: "receipt" as const, id: "historical-single-use-plan" };
      const states = ["running", "succeeded", "failed", "cancelled"] as const;
      const receipts = states.map((state) => {
        const id = `old-${state}`;
        const preparation = { state: "ready", value: { source: "exact\r\nsealed bytes" } };
        const effects = [{ kind: "file", path: `C:/historical/${id}` }];
        const common = {
          id,
          key: "historical.native",
          caller: { kind: "human", via: "local" },
          basis: { kind: "human" },
          target: { kind: "host" },
          input: { source: "old" },
          effects,
          consumes: [],
          claims: version === 6 && state === "running" ? [claim] : [],
          prepared: preparation,
          recovery: [],
          startedAt: "2026-10-26T00:00:00Z",
          state,
          steps: [
            {
              id: randomUUID(),
              key: "historical.native",
              kind: "native",
              input: {},
              state,
              dispatchedAt: "2026-10-26T00:00:01Z",
              ...(state === "succeeded" ? { result: { kept: true } } : {}),
              ...(state === "failed" ? { error: "known native failure", status: 422 } : {}),
              ...(state === "cancelled" ? { error: "native cancellation", status: 499 } : {}),
            },
          ],
          ...(state === "succeeded" ? { result: { kept: true } } : {}),
          ...(state === "failed" ? { error: "known native failure", status: 422 } : {}),
          ...(state === "cancelled" ? { error: "native cancellation", status: 499 } : {}),
        };
        const value =
          version === 6
            ? common
            : {
                ...common,
                kind: "workflow",
                destination: common.target,
                request: common.input,
                preparation,
                footprint: [...effects, { kind: "receipt", pod: "p", path: "plans/reusable.json" }],
              };
        return {
          schema: 1,
          id: randomUUID(),
          revision: 1,
          at: common.startedAt,
          stamp: null,
          join: { actionId: randomUUID(), requestId: randomUUID() },
          body: { kind: "action", value },
        };
      });
      const mappings = Object.fromEntries(
        receipts.flatMap((receipt) => [
          [JSON.stringify(["action", receipt.body.value.id]), receipt.join.actionId],
          [JSON.stringify(["action-request", receipt.body.value.id]), receipt.join.requestId],
        ]),
      );
      const bytes = Buffer.from(
        version === 4
          ? `${JSON.stringify({ version, receipts, mappings })}\r\n`
          : [
              JSON.stringify({ version }),
              ...Object.entries(mappings).map((mapping) => JSON.stringify({ mapping })),
              ...receipts.map((receipt) => JSON.stringify({ receipt })),
              "",
            ].join("\r\n"),
      );
      await writeFile(path, bytes);
      const owner = new ActionJournal(path);
      const rows = await owner.list();
      expect(rows.map((row) => row.state)).toEqual(["unknown", "succeeded", "failed", "cancelled"]);
      expect(rows[1]).toMatchObject({
        result: { kept: true },
        steps: [{ result: { kept: true } }],
      });
      expect(rows[2]).toMatchObject({ error: "known native failure", status: 422 });
      expect(rows[3]).toMatchObject({ error: "native cancellation", status: 499 });
      expect(rows[0]).toMatchObject({
        claims: version === 6 ? [claim] : [],
        effects: [{ kind: "file", path: "C:/historical/old-running" }],
        steps: [{ state: "unknown", dispatchedAt: "2026-10-26T00:00:01Z" }],
        refusal: { code: "historical-schema" },
      });
      const provenance = rows[0]!.recovery.at(-1)!.evidence as { archive: string; sha256: string };
      expect(await readFile(provenance.archive)).toEqual(bytes);
      expect(provenance.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      let executions = 0;
      registerFixtureCommand(
        owner,
        "historical.native",
        fixtureCommand(
          [],
          async () => null,
          async () => ++executions,
        ),
      );
      await expect(
        owner.resume("old-running", { caller: rows[0]!.caller, basis: rows[0]!.basis }),
      ).rejects.toThrow("Historical schema");
      if (version === 6) {
        registerFixtureCommand(
          owner,
          "new.claim",
          fixtureCommand(
            [],
            async () => null,
            async () => ++executions,
            [],
            [claim],
          ),
        );
        await owner.invoke(
          { id: "new", key: "new.claim", target: { kind: "host" }, input: {} },
          { caller: rows[0]!.caller, basis: rows[0]!.basis },
        );
        expect(await owner.wait("new")).toMatchObject({
          state: "failed",
          refusal: { kind: "claimed", by: "old-running" },
        });
      }
      expect(executions).toBe(0);
      expect((await readFile(path, "utf8")).split("\n")[0]).toBe('{"version":7}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
