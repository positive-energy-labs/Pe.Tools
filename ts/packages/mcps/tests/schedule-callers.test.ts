import { expect, test, vi } from "vite-plus/test";
import { cli } from "gunshi";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setup } from "../../../apps/host/tests/schedule-test-fixture.ts";
import { PeaCliCommands } from "../src/pea/PeaCliCommands.ts";
import { peRead, peDo } from "../src/pea/capability-tools.ts";

test("Gunshi Schedule read and human apply use exact HTTP action and frozen Work bases", async () => {
  const f = await setup();
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const host = new PeaCliCommands({ hostBaseUrl: "http://host" }).hostCommand();
    const command = host.subCommands!.operations;
    const request = join(f.dir, "request.json");
    await writeFile(request, JSON.stringify({ scheduleId: 42 }), "utf8");
    await cli(
      [
        "call",
        "--key",
        "op:schedule.grid.snapshot",
        "--bridge-session-id",
        "B",
        "--open-document-id",
        "open-B",
        "--request-file",
        request,
      ],
      command,
      { subCommands: command.subCommands },
    );
    expect(JSON.parse(output.mock.calls.at(-1)![0])).toMatchObject({
      target: f.b,
      workspaceId: f.scope.work,
    });
    await writeFile(request, JSON.stringify({ bases: (await f.admission()).bases }), "utf8");
    await cli(
      [
        "call",
        "--key",
        "workflow:schedule.grid.push",
        "--bridge-session-id",
        "B",
        "--open-document-id",
        "open-B",
        "--actor",
        "human",
        "--action-id",
        "cli-schedule-original",
        "--request-file",
        request,
      ],
      command,
      { subCommands: command.subCommands },
    );
    // The admission builder returns the succeeded receipt's result; a failure names the id.
    expect(JSON.parse(output.mock.calls.at(-1)![0])).toMatchObject({ applied: 1, failures: [] });
    expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
    expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined();
  } finally {
    output.mockRestore();
  }
});

test("Pea Schedule A/B/A reads honor the thread head and cannot perform human-only apply", async () => {
  const f = await setup();
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://host");
  // A harness child's call: `PE_THREAD` names the thread and the host answers its live head.
  vi.stubEnv("PE_THREAD", "t");
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    new URL(input instanceof Request ? input.url : String(input), "http://host").pathname ===
    "/pe/scope/t"
      ? Promise.resolve(Response.json({ defaultTarget: { kind: "open", ref: f.a }, revision: 1 }))
      : inner(input as string, init),
  );
  const run = (tool: typeof peRead | typeof peDo, input: unknown) =>
    tool.execute!(input as never, { agent: { toolCallId: "schedule-call" } } as never);
  const start = f.sent.length;
  for (const target of [undefined, { kind: "open", ref: f.b }, undefined]) {
    const result = await run(peRead, {
      key: "op:schedule.grid.snapshot",
      input: { scheduleId: 42 },
      target,
      timeoutSeconds: 5,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  }
  expect(
    f.sent
      .slice(start)
      .filter((s) => s.key === "revit.detail.schedules")
      .map((s) => [s.session, s.openId]),
  ).toEqual([
    ["A", "open-A"],
    ["B", "open-B"],
    ["A", "open-A"],
  ]);
  expect(
    await run(peDo, {
      key: "workflow:schedule.grid.push",
      input: { bases: (await f.admission()).bases },
      timeoutSeconds: 5,
    }),
  ).toMatchObject({ ok: false });
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(0);
});
