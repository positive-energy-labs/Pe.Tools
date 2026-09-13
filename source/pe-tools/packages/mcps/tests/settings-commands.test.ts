import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  settingsRouteState,
  settingsCandidate,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";
import { HostRpcCaller } from "../src/shared/host-rpc-caller.ts";
import { createSettingsCommandHandlers } from "../src/pea/settings-commands.ts";

afterEach(() => vi.restoreAllMocks());
const id = (file = "a.json") => ({ moduleKey: "Global", rootKey: "fragments", relativePath: file });
const snapshot = (rawContent = '{"x":1}', version = "v1", file = "a.json") => ({
  metadata: {
    documentId: { ...id(file), stableId: `C:/Settings/${file}` },
    workspaceId: `settings:${file}`,
    kind: "Profile",
    versionToken: { value: version },
  },
  rawContent,
  composedContent: rawContent,
  dependencies: [],
  capabilityHints: {},
  validation: { isValid: true, issues: [] },
});
const work = (): SettingsRouteDocument => ({
  basis: {
    documentId: id(),
    path: "C:/Settings/a.json",
    rawContent: '{"x":1}',
    versionToken: "v1",
  },
  fields: { "/x": { staged: { value: 2 }, proposal: { value: 3, by: "pea" } } },
});
const context = (document: SettingsRouteDocument) => ({
  target: null,
  work: "settings:a.json",
  getDoc: () => structuredClone(document),
  setDoc: async (next: SettingsRouteDocument) => {
    Object.assign(document, next);
  },
});

test("refresh and conflicts preserve pending work; adoption requires the reviewed disk version", async () => {
  const document = work(),
    before = structuredClone(document);
  vi.spyOn(HostRpcCaller.prototype, "call").mockImplementation(
    async (key) =>
      (key === "settings.document.save"
        ? { kind: "conflict", current: snapshot("{}", "v2") }
        : snapshot("{}", "v2")) as never,
  );
  const handlers = createSettingsCommandHandlers({ hostBaseUrl: "http://host.test" });
  await handlers.refresh({}, context(document));
  expect(document).toEqual(before);
  await expect(handlers.open({ documentId: id() }, context(document))).rejects.toThrow(
    "Pending work",
  );
  await expect(
    handlers.adopt({ documentId: id(), versionToken: "v1" }, context(document)),
  ).rejects.toThrow("changed after review");
  await handlers.adopt({ documentId: id(), versionToken: "v2" }, context(document));
  expect(document.fields).toEqual({});
  expect(document.basis?.versionToken).toBe("v2");
});

test("malformed raw stays exact; structured splicing refuses without loss", () => {
  const raw = "\uFEFF{ broken\r\n";
  expect(settingsCandidate(raw, {})).toBe(raw);
  expect(() => settingsCandidate(raw, { "/x": { staged: { value: 1 } } })).toThrow();
  expect(settingsCandidate(raw, { "": { staged: { value: raw + "!" } } })).toBe(raw + "!");
  expect(() =>
    settingsCandidate('{"x":{"$include":"a"}}', { "/x/a": { staged: { value: 1 } } }),
  ).toThrow("shared fragment");
});

test("real Work runtime keeps two files and two panes separate and rejects stale reviewed revision", async () => {
  const rows = new Map<string, unknown>();
  vi.spyOn(HostRpcCaller.prototype, "call").mockImplementation(async (_key, request: any) => {
    if (request.workspaceId !== `settings:${request.documentId.relativePath}`)
      throw new Error("another Work");
    return snapshot('{"x":1}', "v1", request.documentId.relativePath) as never;
  });
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
  const a = { route: "settings", target: null, work: "settings:a.json" },
    b = { route: "settings", target: null, work: "settings:b.json" };
  expect((await runtime.command(a, "settings", "human", "open", { documentId: id() }, 0)).ok).toBe(
    true,
  );
  expect(
    (
      await runtime.apply(
        a,
        "settings",
        "human",
        [{ path: ["fields", "/x", "staged"], value: { value: 9 } }],
        1,
      )
    ).ok,
  ).toBe(true);
  expect(
    (await runtime.command(b, "settings", "human", "open", { documentId: id("b.json") }, 0)).ok,
  ).toBe(true);
  expect(
    (
      await runtime.command(
        a,
        "settings",
        "human",
        "adopt",
        { documentId: id("b.json"), versionToken: "v1" },
        2,
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await runtime.command(
        a,
        "settings",
        "human",
        "adopt",
        { documentId: id(), versionToken: "v1" },
        1,
        "stale-adopt",
      )
    ).ok,
  ).toBe(false);
  const pane1 = await runtime.read(a, "settings"),
    pane2 = await runtime.read(a, "settings");
  expect(pane1).toEqual(pane2);
  expect(pane1).toMatchObject({
    doc: { basis: { documentId: id() }, fields: { "/x": { staged: { value: 9 } } } },
  });
  expect(await runtime.read(b, "settings")).toMatchObject({
    doc: { basis: { documentId: id("b.json") }, fields: {} },
  });
});
