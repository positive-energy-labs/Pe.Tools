import { test, expect } from "vite-plus/test";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSettingsDocumentWithModule, validateSettingsDocument } from "../src/settings.ts";

test("editor delegates captured draft composition and preserves native gate reasons", async () => {
  const root = await mkdtemp(join(tmpdir(), "pod-editor-"));
  const workspace = "Local Copy";
  const documentId = { moduleKey: workspace, rootKey: "settings", relativePath: "main.json" };
  const module = {
    moduleKey: workspace,
    defaultRootKey: "settings",
    roots: [{ rootKey: "settings", displayName: "Settings" }],
  };
  const raw = '{"$preset":"@local/settings/base.json"}';
  try {
    await mkdir(join(root, workspace, "settings"), { recursive: true });
    await writeFile(join(root, workspace, "pod.json"), '{"id":"lineage"}');
    await writeFile(join(root, workspace, "settings", "main.json"), raw);
    await writeFile(join(root, workspace, "settings", "base.json"), '{"value":1}');
    let refused = false;
    let captured = "";
    const ctx = {
      storageRoot: root,
      invokeBridge: (operation: string, payload?: unknown) => {
        if (operation === "scripting.pod.prepare") {
          const request = payload as {
            workspaceKey: string;
            sourceBundle: { files: { path: string; bytesBase64: string }[] };
          };
          expect(request.workspaceKey).toBe(workspace);
          captured = Buffer.from(
            request.sourceBundle.files.find((file) => file.path === "settings/main.json")!
              .bytesBase64,
            "base64",
          ).toString("utf8");
          return Effect.succeed(
            refused
              ? {
                  contentHash: null,
                  composedSettings: {},
                  outcomes: [
                    {
                      code: "pod.settings.reference",
                      location: "settings/main.json",
                      reason: "Pinned dependency is unavailable",
                      remedy: "Install the pinned release",
                      severity: "Error",
                    },
                  ],
                }
              : {
                  contentHash: "snapshot",
                  composedSettings: { "composed/main.json": '{"value":42}' },
                  outcomes: [],
                },
          );
        }
        if (operation === "settings.module-catalog") return Effect.succeed({ modules: [module] });
        return Effect.succeed({});
      },
    };
    const open = () =>
      Effect.runPromise(
        openSettingsDocumentWithModule(
          { documentId, includeComposedContent: true },
          module,
          ctx,
        ).pipe(Effect.provide(NodeServices.layer)),
      );
    const result = await open();
    expect(result.rawContent).toBe(raw);
    expect(JSON.parse(result.composedContent!)).toEqual({ value: 42 });
    expect(captured).toBe(raw);
    const draft = '{"$preset":"@local/settings/changed.json"}';
    await Effect.runPromise(
      validateSettingsDocument({ documentId, rawContent: draft }, ctx).pipe(
        Effect.provide(NodeServices.layer),
      ),
    );
    expect(captured).toBe(draft);
    refused = true;
    const failure = await open();
    expect(failure.composedContent).toBeNull();
    expect(failure.validation.issues).toContainEqual({
      path: "settings/main.json",
      code: "pod.settings.reference",
      severity: "error",
      message: "Pinned dependency is unavailable",
      suggestion: "Install the pinned release",
    });
    const offline = await Effect.runPromise(
      openSettingsDocumentWithModule({ documentId, includeComposedContent: true }, module, {
        storageRoot: root,
      }).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(offline.validation.isValid).toBe(false);
    expect(offline.validation.issues[0].code).toBe("PodPreparationUnavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
