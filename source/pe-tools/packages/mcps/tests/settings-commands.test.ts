import { expect, test } from "vite-plus/test";
import type { FamiliesRouteDocument, SettingsRouteDocument } from "@pe/agent-contracts";
import { createFamiliesCommandHandlers } from "../src/pea/families-commands.ts";
import { createSettingsCommandHandlers } from "../src/pea/settings-commands.ts";

/**
 * Settings handlers reach the TS host over POST /call. We stub globalThis.fetch and
 * dispatch on the request `key`, exactly like host-rpc-caller.test.ts, so each test
 * pins the host contract the handler depends on without a live host.
 */

type HostResponder = (key: string, request: unknown, headers: Headers) => unknown;

async function withHost<T>(responder: HostResponder, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: { key: string; request: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).pathname !== "/call") throw new Error(`unexpected fetch to ${url}`);
    const rawBody = init?.body;
    if (typeof rawBody !== "string") throw new Error("expected JSON request body");
    const body = JSON.parse(rawBody) as { key: string; request: unknown };
    calls.push(body);
    const headers = new Headers(init?.headers);
    const target = headers.get("x-pe-bridge-session-id")?.replace(/^session:/, "") ?? "test";
    return new Response(
      JSON.stringify(
        body.key === "bridge.sessions.summary"
          ? {
              sdkSessionId: target,
              processId: 42,
              activeDocument: { path: "C:\\Models\\Test.rvt" },
            }
          : responder(body.key, body.request, headers),
      ),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    void calls;
  }
}

const DOCUMENT_ID = { moduleKey: "m", rootKey: "r", relativePath: "settings.json" };
const DOCUMENT_PATH = "C:\\Settings\\settings.json";

function emptyDocument(): SettingsRouteDocument {
  return { binding: { target: null }, snapshot: null, fields: {}, savedAt: null };
}

function openResponse(rawContent: string, versionValue = "v1") {
  return {
    capabilityHints: {},
    composedContent: `composed:${rawContent}`,
    dependencies: [],
    metadata: {
      documentId: { ...DOCUMENT_ID, stableId: DOCUMENT_PATH },
      kind: "Authoring",
      modifiedUtc: "2026-07-13T00:00:00Z",
      versionToken: { value: versionValue },
    },
    rawContent,
    validation: { isValid: true, issues: [] },
  };
}

function routeSnapshot(rawContent: string, versionToken = "v1") {
  return {
    from: {
      target: DOCUMENT_PATH,
      documentId: DOCUMENT_PATH,
      documentVersionToken: versionToken,
      observedAt: "2026-08-25T00:00:00Z",
      settingsDocumentId: DOCUMENT_ID,
    },
    rawContent,
    composedContent: null,
    modifiedUtc: null,
    validation: { isValid: true, issues: [] },
  };
}

const handlers = () => createSettingsCommandHandlers({ hostBaseUrl: "http://127.0.0.1:5180" });

test("open maps the host snapshot into the route document, flattening the version token", async () => {
  const document = emptyDocument();
  await withHost(
    (key) => {
      if (key === "settings.document.open")
        return openResponse('{"revit":{"units":"mm"}}', "token-7");
      throw new Error(`unexpected op ${key}`);
    },
    async () => {
      await handlers().open(
        { documentId: DOCUMENT_ID },
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      );
    },
  );

  expect(document.snapshot?.from.settingsDocumentId).toEqual(DOCUMENT_ID);
  expect(document.snapshot?.from.target).toBe(DOCUMENT_PATH);
  expect(document.snapshot?.from.documentId).toBe(DOCUMENT_PATH);
  expect(document.snapshot?.rawContent).toBe('{"revit":{"units":"mm"}}');
  expect(document.snapshot?.composedContent).toBe('composed:{"revit":{"units":"mm"}}');
  expect(document.snapshot?.from.documentVersionToken).toBe("token-7");
  expect(document.snapshot?.modifiedUtc).toBe("2026-07-13T00:00:00Z");
  expect(document.snapshot?.validation?.isValid).toBe(true);
  expect(document.snapshot?.from.observedAt).toBeTruthy();
});

test("settings commands target the route binding when module discovery needs a Revit session", async () => {
  const document = emptyDocument();
  document.binding.target = "session:family-model";
  let targeted = "";
  await withHost(
    (_key, _request, headers) => {
      targeted = headers.get("x-pe-bridge-session-id") ?? "";
      return openResponse("{}");
    },
    async () => {
      await handlers().open(
        { documentId: DOCUMENT_ID },
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      );
    },
  );
  expect(targeted).toBe("session:family-model");
});

test("open preserves existing fields (proposals/staged survive a re-open)", async () => {
  const document: SettingsRouteDocument = {
    binding: { target: null },
    snapshot: null,
    fields: {
      "/revit/units": { proposal: { value: "in", by: "pea" }, review: "none" },
    },
    savedAt: null,
  };
  await withHost(
    () => openResponse("{}"),
    async () => {
      await handlers().open(
        { documentId: DOCUMENT_ID },
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      );
    },
  );
  expect(document.fields["/revit/units"]?.proposal?.value).toBe("in");
});

test("refresh without an open document throws a hint to run open first", async () => {
  const document = emptyDocument();
  await expect(
    handlers().refresh({}, { getDoc: () => document, setDoc: async () => undefined }),
  ).rejects.toThrow(/No settings document is open/);
});

test("validate splices staged values only; proposals join in with includeProposals", async () => {
  const document: SettingsRouteDocument = {
    binding: { target: null },
    snapshot: routeSnapshot('{"revit":{"units":"mm","scale":1}}'),
    fields: {
      "/revit/units": {
        proposal: { value: "cm", by: "pea" },
        staged: { value: "in" },
        review: "good",
      },
      "/revit/scale": { proposal: { value: 48, by: "pea" }, review: "none" },
    },
    savedAt: null,
  };

  const seen: unknown[] = [];
  await withHost(
    (key, request) => {
      if (key === "settings.document.validate") {
        seen.push((request as { rawContent: string }).rawContent);
        return { isValid: true, issues: [] };
      }
      throw new Error(`unexpected op ${key}`);
    },
    async () => {
      // staged only: units -> "in" (staged wins), scale untouched (proposal not included).
      await handlers().validate(
        {},
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      );
      // includeProposals: scale -> 48 (proposal), units still "in" (staged overrides proposal).
      await handlers().validate(
        { includeProposals: true },
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      );
    },
  );

  expect(JSON.parse(seen[0] as string)).toEqual({ revit: { units: "in", scale: 1 } });
  expect(JSON.parse(seen[1] as string)).toEqual({ revit: { units: "in", scale: 48 } });
});

test("save can delete an authored JSON property without a sentinel value", async () => {
  const document: SettingsRouteDocument = {
    binding: { target: null },
    snapshot: routeSnapshot('{"types":{"Wide":{"Width":"24in","Depth":"10in"}}}'),
    fields: {
      "/types/Wide/Width": { staged: { delete: true }, review: "good" },
    },
    savedAt: null,
  };
  let savedRaw = "";

  await withHost(
    (key, request) => {
      if (key === "settings.document.save") {
        savedRaw = (request as { rawContent: string }).rawContent;
        return {
          conflictDetected: false,
          writeApplied: true,
          metadata: {
            documentId: DOCUMENT_ID,
            kind: "Authoring",
            modifiedUtc: "2026-07-13T01:00:00Z",
            versionToken: { value: "v2" },
          },
          validation: { isValid: true, issues: [] },
        };
      }
      if (key === "settings.document.open") return openResponse(savedRaw, "v2");
      throw new Error(`unexpected op ${key}`);
    },
    async () =>
      handlers().save(
        {},
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      ),
  );

  expect(JSON.parse(savedRaw)).toEqual({ types: { Wide: { Depth: "10in" } } });
});

test("validate folds the host result into the snapshot", async () => {
  const document: SettingsRouteDocument = {
    binding: { target: null },
    snapshot: routeSnapshot("{}"),
    fields: {},
    savedAt: null,
  };
  const result = await withHost(
    () => ({
      isValid: false,
      issues: [{ code: "x", message: "bad", path: "$", severity: "error" }],
    }),
    async () =>
      handlers().validate(
        {},
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      ),
  );
  expect((result as { isValid: boolean }).isValid).toBe(false);
  expect(document.snapshot?.validation?.isValid).toBe(false);
  expect(document.snapshot?.validation?.issues).toHaveLength(1);
});

test("save splices staged fields, sends the captured token, folds the result, and clears staged", async () => {
  const document: SettingsRouteDocument = {
    binding: { target: null },
    snapshot: routeSnapshot('{"revit":{"units":"mm"}}'),
    fields: {
      "/revit/units": {
        proposal: { value: "in", by: "pea" },
        staged: { value: "in" },
        review: "good",
      },
    },
    savedAt: null,
  };

  let savedRequest: { rawContent: string; expectedVersionToken?: { value: string } } | undefined;
  await withHost(
    (key, request) => {
      if (key === "settings.document.save") {
        savedRequest = request as typeof savedRequest;
        return {
          conflictDetected: false,
          writeApplied: true,
          metadata: {
            documentId: DOCUMENT_ID,
            kind: "Authoring",
            modifiedUtc: "2026-07-13T01:00:00Z",
            versionToken: { value: "v2" },
          },
          validation: { isValid: true, issues: [] },
        };
      }
      if (key === "settings.document.open") return openResponse(savedRequest!.rawContent, "v2");
      throw new Error(`unexpected op ${key}`);
    },
    async () => {
      await handlers().save(
        {},
        { getDoc: () => document, setDoc: async (next) => void Object.assign(document, next) },
      );
    },
  );

  expect(JSON.parse(savedRequest!.rawContent)).toEqual({ revit: { units: "in" } });
  expect(savedRequest!.expectedVersionToken).toEqual({ value: "v1" });
  expect(document.snapshot?.from.documentVersionToken).toBe("v2");
  expect(document.snapshot?.rawContent).toBe(JSON.stringify({ revit: { units: "in" } }, null, 2));
  expect(document.snapshot?.composedContent).toBe(
    `composed:${JSON.stringify({ revit: { units: "in" } }, null, 2)}`,
  );
  expect(document.fields["/revit/units"]).toEqual({ review: "none" });
  expect(document.savedAt).toBeTruthy();
});

test("save on a host conflict throws with the conflict message and a refresh hint", async () => {
  const document: SettingsRouteDocument = {
    binding: { target: null },
    snapshot: routeSnapshot("{}", "stale"),
    fields: {
      "/a": { staged: { value: 1 }, review: "good" },
    },
    savedAt: null,
  };
  await expect(
    withHost(
      () => ({
        conflictDetected: true,
        conflictMessage: "newer version on disk",
        writeApplied: false,
        metadata: {
          documentId: DOCUMENT_ID,
          kind: "Authoring",
          modifiedUtc: null,
          versionToken: { value: "v9" },
        },
        validation: { isValid: true, issues: [] },
      }),
      async () => handlers().save({}, { getDoc: () => document, setDoc: async () => undefined }),
    ),
  ).rejects.toThrow(/newer version on disk[\s\S]*refresh/i);
  // Staged field is untouched so the human can refresh and retry.
  expect(document.fields["/a"]?.staged != null).toBe(true);
});

test("save blocks when a staged field still needs attention", async () => {
  const document: SettingsRouteDocument = {
    binding: { target: null },
    snapshot: routeSnapshot("{}"),
    fields: { a: { staged: { value: 1 }, review: "attention" } },
    savedAt: null,
  };
  await expect(
    handlers().save({}, { getDoc: () => document, setDoc: async () => undefined }),
  ).rejects.toThrow(/Save blocked/);
});

test("families handlers filter the plan, refuse drift, exclude IDs, and write receipts", async () => {
  const document: FamiliesRouteDocument = {
    binding: { target: "session:family" },
    profilePath: null,
    plan: null,
    excludedIds: [],
    apply: null,
  };
  const requests: Array<{ key: string; request: unknown }> = [];
  const handler = createFamiliesCommandHandlers({ hostBaseUrl: "http://127.0.0.1:5180" });
  const ctx = {
    getDoc: () => document,
    setDoc: async (next: FamiliesRouteDocument) => void Object.assign(document, next),
  };
  await withHost(
    (key, request) => {
      requests.push({ key, request });
      if (key === "settings.document.open") return { rawContent: "{}" };
      if (key === "familyfoundry.plan")
        return {
          planHash: "hash-2",
          diagnostics: [],
          families: ["Desk", "Chair", "Outside"].map((familyName, index) => ({
            familyId: index + 1,
            familyName,
            plan: {
              parameters: [],
              requiredApsParameterNames: [],
              familyParameterNames: [],
              loweredActions: [
                { operation: "set", target: "Width", sources: [], reason: "profile" },
              ],
            },
          })),
        };
      if (key === "familyfoundry.apply")
        return {
          planHash: "hash-2",
          refused: false,
          diagnostics: [],
          receipts: [
            {
              familyId: 1,
              familyName: "Desk",
              success: true,
              error: null,
              operationsRun: ["set"],
              parametersChanged: 1,
              diffSummary: { added: 1, removed: 0, modified: 0 },
              artifactDirectoryPath: "artifacts/desk",
            },
          ],
        };
      throw new Error(`unexpected op ${key}`);
    },
    async () => {
      await handler.plan(
        { profilePath: "desk.json", scope: { familyNames: ["Desk", "Chair"] } },
        ctx,
      );
      expect(document.plan?.entries.map(({ familyName }) => familyName)).toEqual(["Desk", "Chair"]);
      document.excludedIds = [2];
      await expect(handler.apply({ expectedPlanHash: "stale" }, ctx)).rejects.toThrow(/plan drift/);
      await handler.apply({ expectedPlanHash: "hash-2" }, ctx);
    },
  );
  expect(requests.find(({ key }) => key === "familyfoundry.apply")?.request).toMatchObject({
    familyIds: [1],
  });
  expect(document.apply?.receipts).toHaveLength(1);
  expect(document.apply?.artifacts).toEqual(["artifacts/desk"]);
});
