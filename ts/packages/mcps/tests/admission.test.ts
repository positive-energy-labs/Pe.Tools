import { withInvocationContext } from "../src/shared/invocation-context.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { peDo, peRead } from "../src/pea/capability-tools.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import { bodyText } from "./body-text.ts";

const operations: HostOperationDefinition[] = [
  { key: "scripting.execute", intent: "Mutate", needs: "document" },
  { key: "scripting.workspace.bootstrap", intent: "Mutate", needs: "nothing" },
  { key: "pod.import", intent: "Mutate", needs: "nothing" },
  { key: "pod.export", intent: "Mutate", needs: "nothing" },
  { key: "revit.context.summary", intent: "Read", needs: "document" },
];
const target = { kind: "open", ref: { session: "A", openId: "open-A" } } as const;
const destination = { kind: "document", ref: target.ref };
const receipt = (admission: Record<string, unknown>) => {
  const { input, ...rest } = admission;
  return {
    ...rest,
    request: input,
    state: "succeeded",
    result: { done: true },
    steps: [],
    preparation: { state: "unprepared" },
    recovery: [],
    publication: { state: "unrequested" },
    startedAt: new Date(0).toISOString(),
  };
};

function host(prior?: Record<string, unknown>) {
  const posts: Record<string, unknown>[] = [];
  const reads: string[] = [];
  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    reads.push(url.pathname);
    if (url.pathname === "/actions") {
      if (init?.method !== "POST") return Response.json(prior ? [prior] : []);
      const body = JSON.parse(await bodyText(init));
      posts.push(body);
      return Response.json(receipt(body));
    }
    if (prior) throw Error("Replay must not consult a live catalog or target");
    if (url.pathname === "/pe/capabilities")
      return Response.json({
        at: new Date(0).toISOString(),
        sources: {},
        sessions: [],
        capabilities: buildCapabilities({ ops: operations, routes: [], pods: null, skills: [] }),
      });
    if (url.pathname === "/ops") return Response.json({ operations, bridgeSessionId: "A" });
    if (url.pathname === "/call") {
      const body = JSON.parse(await bodyText(init));
      if (body.key === "bridge.sessions.list")
        return Response.json({
          sessions: [
            {
              sessionId: "A",
              connected: true,
              openDocuments: [{ openId: "open-A", address: "C:/A.rvt", isFamilyDocument: false }],
            },
          ],
        });
      if (body.key === "revit.context.summary") return Response.json({ title: "A" });
      throw Error(`Raw mutation on /call: ${body.key}`);
    }
    throw Error(`Unexpected ${url.href}`);
  });
  return { posts, reads };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (tool: typeof peDo | typeof peRead, input: Record<string, unknown>, id = "attempt") =>
  withInvocationContext({ hostBaseUrl: "http://admission.test" }, () =>
    tool.execute!(
      { timeoutSeconds: 30, ...input } as never,
      { agent: { toolCallId: id } } as never,
    ),
  ) as Promise<Record<string, unknown>>;

test("pe_do admits native operations and workflows with exact identity, actor, target and bases", async () => {
  const { posts } = host();
  expect(
    await call(peDo, { key: "op:scripting.execute", target, input: { scriptContent: "x" } }),
  ).toMatchObject({ ok: true });
  for (const key of ["scripting.workspace.bootstrap", "pod.import", "pod.export"])
    expect(await call(peDo, { key: `op:${key}`, target: { id: "A" } }, key)).toMatchObject({
      ok: true,
    });
  const bases = { captureId: "c".repeat(64) };
  expect(
    await call(peDo, {
      key: "workflow:takeoffs.partition",
      target,
      input: {
        zoneRegion: 1,
        view: "v",
        zoneName: "z",
        zoneGuid: "g",
        bases,
        actionId: "workflow",
      },
    }),
  ).toMatchObject({ ok: true });
  expect(posts).toMatchObject([
    {
      id: "attempt",
      kind: "operation",
      key: "scripting.execute",
      actor: "agent",
      destination,
      input: { scriptContent: "x" },
      bases: {},
    },
    ...["scripting.workspace.bootstrap", "pod.import", "pod.export"].map((key) => ({
      id: key,
      kind: "operation",
      key,
      actor: "agent",
      destination: { kind: "session", session: "A" },
    })),
    {
      id: "workflow",
      kind: "workflow",
      key: "takeoffs.partition",
      actor: "agent",
      destination,
      bases,
    },
  ]);
  expect(posts.at(-1)?.input).not.toHaveProperty("bases");
});

test("pe_read refuses mutations; pe_do refuses human, unknown and missing or closed targets before admission", async () => {
  const { posts } = host();
  expect(await call(peRead, { key: "op:scripting.execute", target })).toMatchObject({
    isError: true,
    content: expect.stringContaining("pe_do"),
  });
  for (const input of [
    { key: "workflow:families.apply", target },
    { key: "op:missing", target },
    { key: "op:scripting.execute" },
    {
      key: "op:scripting.execute",
      target: { kind: "open", ref: { session: "A", openId: "closed" } },
    },
  ])
    expect(await call(peDo, input)).toMatchObject({ isError: true });
  expect(posts).toEqual([]);
  expect(await call(peRead, { key: "op:revit.context.summary", target })).toMatchObject({
    ok: true,
    result: { title: "A" },
  });
  expect(posts).toEqual([]);
});

test("pe_do replays the original receipt without catalog or target discovery and refuses changed intent or destination", async () => {
  const { posts, reads } = host(
    receipt({
      id: "attempt",
      kind: "operation",
      key: "scripting.execute",
      actor: "agent",
      destination,
      input: { scriptContent: "x" },
      bases: {},
    }),
  );
  expect(
    await call(peDo, { key: "op:scripting.execute", input: { scriptContent: "x" } }),
  ).toMatchObject({ ok: true });
  expect(posts).toMatchObject([{ id: "attempt", destination, input: { scriptContent: "x" } }]);
  await expect(
    call(peDo, { key: "op:scripting.execute", input: { scriptContent: "changed" } }),
  ).rejects.toThrow("conflicts");
  await expect(
    call(peDo, {
      key: "op:scripting.execute",
      input: { scriptContent: "x" },
      target: { kind: "open", ref: { session: "B", openId: "open-B" } },
    }),
  ).rejects.toThrow("destination");
  expect(posts).toHaveLength(1);
  expect(new Set(reads)).toEqual(new Set(["/actions"]));
});
