import { expect, test } from "vite-plus/test";
import { address, type SettingsRouteDocument } from "@pe/agent-contracts";
import { createSettingsCommandHandlers } from "../src/pea/settings-commands.ts";

const DOCUMENT_ID = { moduleKey: "m", rootKey: "r", relativePath: "settings.json" };
const DOCUMENT_PATH = "C:\\Settings\\settings.json";
const DOCUMENT_ADDRESS = address("C:\\Models\\A.rvt");

function openResponse(rawContent: string, version = "v1") {
  return {
    capabilityHints: {},
    composedContent: `composed:${rawContent}`,
    dependencies: [],
    metadata: {
      documentId: { ...DOCUMENT_ID, stableId: DOCUMENT_PATH },
      kind: "Authoring",
      modifiedUtc: "2026-07-13T00:00:00Z",
      versionToken: { value: version },
    },
    rawContent,
    validation: { isValid: true, issues: [] },
  };
}

async function withHost(
  responder: (key: string, request: unknown) => unknown,
  run: (calls: Array<{ key: string; request: unknown; target: string | null }>) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ key: string; request: unknown; target: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).pathname !== "/call") throw new Error(`unexpected fetch to ${url}`);
    if (typeof init?.body !== "string") throw new Error("expected JSON request body");
    const body = JSON.parse(init.body) as { key: string; request: unknown };
    calls.push({
      ...body,
      target: new Headers(init.headers).get("x-pe-bridge-session-id"),
    });
    return new Response(JSON.stringify(responder(body.key, body.request)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function context(document: SettingsRouteDocument) {
  return {
    scope: { session: null, document: DOCUMENT_ADDRESS },
    getDoc: () => document,
    setDoc: async (next: SettingsRouteDocument) => void Object.assign(document, next),
  };
}

test("settings opens with no world bound and persists no file snapshot", async () => {
  await withHost(
    (key) => {
      if (key !== "settings.document.open") throw new Error(`unexpected operation ${key}`);
      return openResponse('{"x":1}');
    },
    async (calls) => {
      const document: SettingsRouteDocument = {
        bindings: {},
        documentId: null,
        fields: {},
        savedAt: null,
      };
      await createSettingsCommandHandlers({ hostBaseUrl: "http://host.test" }).open(
        { documentId: DOCUMENT_ID },
        context(document),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.target).toBeNull();
      expect(document).toMatchObject({
        bindings: {
          file: { id: DOCUMENT_PATH, label: DOCUMENT_PATH },
        },
        documentId: DOCUMENT_ID,
      });
      expect(document).not.toHaveProperty("snapshot");
    },
  );
});

test("settings save refetches and uses the file version without persisting it", async () => {
  await withHost(
    (key, request) => {
      if (key === "settings.document.open") return openResponse('{"x":1}', "v2");
      if (key === "settings.document.save") {
        expect(request).toMatchObject({
          documentId: DOCUMENT_ID,
          rawContent: expect.stringContaining('"x": 2'),
          expectedVersionToken: { value: "v2" },
        });
        return {
          conflictDetected: false,
          writeApplied: true,
          validation: { isValid: true, issues: [] },
        };
      }
      throw new Error(`unexpected operation ${key}`);
    },
    async (calls) => {
      const document: SettingsRouteDocument = {
        bindings: {
          file: { id: DOCUMENT_PATH, label: DOCUMENT_PATH },
        },
        documentId: DOCUMENT_ID,
        fields: {
          "/x": { proposal: null, staged: { value: 2 } },
        },
        savedAt: null,
      };
      await createSettingsCommandHandlers({ hostBaseUrl: "http://host.test" }).save(
        {},
        context(document),
      );

      expect(calls.map(({ key }) => key)).toEqual([
        "settings.document.open",
        "settings.document.save",
      ]);
      expect(calls.every(({ target }) => target === null)).toBe(true);
      expect(document.fields["/x"]).toEqual({});
      expect(document).not.toHaveProperty("snapshot");
    },
  );
});
