import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  settingsRouteState,
  settingsCandidate,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import type { MemberIssue, PodMemberComposeResponse } from "@pe/host-contracts/operation-types";
import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";
import { HostRpcCaller } from "../src/shared/host-rpc-caller.ts";
import { createSettingsCommandHandlers, executionContent } from "../src/pea/settings-commands.ts";

afterEach(() => vi.restoreAllMocks());
const member = (path = "settings/a.json") => ({ pod: "pe-standards", path });
const reading = (content = '{"x":1}', sha256 = "v1") => ({
  content,
  sha256,
  bytesBase64: Buffer.from(content).toString("base64"),
});
const composition = (
  composed: string | null,
  diagnostics: MemberIssue[] = [],
): PodMemberComposeResponse => ({
  sha256: "v1",
  schemaUrl: null,
  schemaJson: null,
  composed,
  source: {
    id: "pe-standards",
    path: "settings/a.json",
    sha256: "v1",
    bytesBase64: Buffer.from('{"x":1}').toString("base64"),
    origin: "SavedMember",
  },
  diagnostics,
  dependencies: [],
  schemaValidation: "no-schema",
  semanticValidation: "not-run",
});
const work = (): SettingsRouteDocument => ({
  basis: { member: member(), rawContent: '{"x":1}', sha256: "v1" },
  fields: { "/x": { staged: { value: 2 }, proposal: { value: 3 } } },
});
const context = (document: SettingsRouteDocument) => ({
  target: null,
  work: "pods:a",
  actor: "human" as const,
  getDoc: () => structuredClone(document),
  setDoc: async (next: SettingsRouteDocument) => {
    Object.assign(document, next);
  },
});

test("refresh and conflicts preserve pending work; adoption requires the reviewed disk version", async () => {
  const document = work(),
    before = structuredClone(document);
  const call = vi
    .spyOn(HostRpcCaller.prototype, "call")
    .mockImplementation(async () => reading("{}", "v2") as never);
  const handlers = createSettingsCommandHandlers({ hostBaseUrl: "http://host.test" });
  await handlers.refresh({}, context(document));
  expect(call).toHaveBeenCalledWith("pod.member.read", member());
  expect(document).toEqual(before);
  await expect(handlers.open({ member: member() }, context(document))).rejects.toThrow(
    "Pending work",
  );
  await expect(
    handlers.adopt({ member: member(), sha256: "v1" }, context(document)),
  ).rejects.toThrow("changed after review");
  await expect(
    handlers.adopt({ member: member("settings/b.json"), sha256: "v2" }, context(document)),
  ).rejects.toThrow("bound member");
  await handlers.adopt({ member: member(), sha256: "v2" }, context(document));
  expect(document.fields).toEqual({});
  expect(document.basis?.sha256).toBe("v2");
});

test("validate composes the staged draft of the bound member", async () => {
  const compose = vi.fn(async () => composition("{}"));
  const handlers = createSettingsCommandHandlers({
    pods: { read: async () => reading(), compose },
  });
  await handlers.validate({}, context(work()));
  expect(compose).toHaveBeenCalledWith({ ...member(), content: JSON.stringify({ x: 2 }, null, 2) });
});

test("execution refuses a composition with non-info diagnostics or no composed JSON", () => {
  const issue = (severity: MemberIssue["severity"]) => [
    { code: "x", path: "/x", message: "bad", severity },
  ];
  expect(executionContent(composition('{"x":1}', issue("info")))).toBe('{"x":1}');
  expect(() => executionContent(composition('{"x":1}', issue("error")))).toThrow("/x: bad");
  expect(() => executionContent(composition('{"x":1}', issue("warning")))).toThrow("/x: bad");
  expect(() => executionContent(composition(null))).toThrow("needs a Revit session");
});

test("malformed raw stays exact; structured splicing refuses without loss", () => {
  const raw = "﻿{ broken\r\n";
  expect(settingsCandidate(raw, {})).toBe(raw);
  expect(() => settingsCandidate(raw, { "/x": { staged: { value: 1 } } })).toThrow();
  expect(settingsCandidate(raw, { "": { staged: { value: raw + "!" } } })).toBe(raw + "!");
  expect(() =>
    settingsCandidate('{"x":{"$include":"a"}}', { "/x/a": { staged: { value: 1 } } }),
  ).toThrow("shared fragment");
});

test("real Work runtime keeps two members and two panes separate and rejects stale reviewed revision", async () => {
  const rows = new Map<string, unknown>();
  vi.spyOn(HostRpcCaller.prototype, "call").mockImplementation(async () => reading() as never);
  const runtime = new RouteWorkspace({
    registrations: [
      {
        spec: settingsRouteState,
        handlers: createSettingsCommandHandlers({ hostBaseUrl: "http://host.test" }),
      },
    ],
    store: {
      getState: async ({ targetKey, route }) => rows.get(targetKey + route),
      setState: async ({ targetKey, route, value }) => {
        rows.set(targetKey + route, structuredClone(value));
      },
    },
  });
  const a = { route: "pods", target: null, work: "pods:a" },
    b = { route: "pods", target: null, work: "pods:b" };
  expect((await runtime.command(a, "pods", "human", "open", { member: member() }, 0)).ok).toBe(
    true,
  );
  expect(
    (
      await runtime.apply(
        a,
        "pods",
        "human",
        [{ path: ["fields", "/x", "staged"], value: { value: 9 } }],
        1,
      )
    ).ok,
  ).toBe(true);
  expect(
    (await runtime.command(b, "pods", "human", "open", { member: member("settings/b.json") }, 0))
      .ok,
  ).toBe(true);
  expect(
    (
      await runtime.command(
        a,
        "pods",
        "human",
        "adopt",
        { member: member("settings/b.json"), sha256: "v1" },
        2,
      )
    ).ok,
  ).toBe(false);
  expect(
    (await runtime.command(a, "pods", "human", "adopt", { member: member(), sha256: "v1" }, 1)).ok,
  ).toBe(false);
  const pane1 = await runtime.read(a, "pods"),
    pane2 = await runtime.read(a, "pods");
  expect(pane1).toEqual(pane2);
  expect(pane1).toMatchObject({
    doc: { basis: { member: member() }, fields: { "/x": { staged: { value: 9 } } } },
  });
  expect(await runtime.read(b, "pods")).toMatchObject({
    doc: { basis: { member: member("settings/b.json") }, fields: {} },
  });
});
