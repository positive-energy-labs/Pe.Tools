import { admitFamilyAction } from "../src/family-actions.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { settingsRouteState } from "@pe/agent-contracts";
import { createSettingsCommandHandlers } from "../../../packages/mcps/src/pea/settings-commands.ts";
import { HostRpcCaller } from "../../../packages/mcps/src/shared/host-rpc-caller.ts";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Effect, FileSystem, PlatformError } from "effect";
import { NodeServices, NodeHttpClient } from "@effect/platform-node";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSettingsDocument, saveSettingsDocument } from "../src/settings.ts";
import { writeFileStringAtomic } from "../src/files/index.ts";
import { productPodsRootPath } from "../src/product-paths.ts";
import { dispatchTsOnlyOperation } from "../src/call-route.ts";
import type { RevitBridge } from "../src/bridge.ts";

let directory: string;
let previous: string | undefined;
const documentId = { moduleKey: "sample", rootKey: "settings", relativePath: "file.json" };
const digest = (raw: string | Uint8Array) => createHash("sha256").update(raw).digest("hex");
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici)),
  );
const path = () => join(productPodsRootPath(), "sample", "settings", "file.json");
const open = () =>
  run(openSettingsDocument({ documentId, mode: "file", includeComposedContent: true }));
const save = (rawContent: string, version?: string) =>
  run(
    saveSettingsDocument({
      documentId,
      mode: "file",
      rawContent,
      expected: version === undefined ? { kind: "missing" } : { kind: "present", version },
    }),
  );
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pe-file-basis-"));
  previous = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = directory;
  await mkdir(join(productPodsRootPath(), "sample", "settings"), { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (previous === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
  else process.env.PE_TOOLS_DOCUMENTS_ROOT = previous;
  await rm(directory, { recursive: true, force: true });
});

test("raw bytes, BOM and parse errors retain their corresponding content token", async () => {
  const raw = "\uFEFF{ broken  \r\n";
  await writeFile(path(), raw);
  const result = await open();
  expect(result.rawContent).toBe(raw);
  expect(result.metadata.versionToken?.value).toBe(digest(await readFile(path())));
  expect(result.validation.isValid).toBe(false);
  expect(result.validation.issues[0].code).toBe("JsonParseError");
  const saved = await save(raw + " ", digest(raw));
  expect(saved.kind).toBe("written");
  expect(await readFile(path(), "utf8")).toBe(raw + " ");
});

test("stale and deleted files conflict; equal-content recreation is equivalent", async () => {
  await writeFile(path(), '{"x":1}');
  const token = (await open()).metadata.versionToken!.value;
  await writeFile(path(), '{"x":3}');
  expect((await save('{"x":2}', token)).kind).toBe("conflict");
  expect(await readFile(path(), "utf8")).toBe('{"x":3}');
  await rm(path());
  expect(await save('{"x":2}', token)).toEqual({ kind: "conflict", current: null });
  await writeFile(path(), '{"x":1}');
  expect((await save('{"x":2}', token)).kind).toBe("written");
});

test("direct RPC and another caller serialize conditional saves without Revit", async () => {
  await writeFile(path(), '{"x":1}');
  const token = digest('{"x":1}');
  const bridge = {
    invoke: () => {
      throw new Error("No Revit allowed");
    },
  } as unknown as RevitBridge["Service"];
  const results = await Promise.all([
    Effect.runPromise(
      dispatchTsOnlyOperation(
        "settings.document.save",
        {
          documentId,
          mode: "file",
          rawContent: '{"x":2}',
          expected: { kind: "present", version: token },
        },
        undefined,
        bridge,
      ).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici)),
    ),
    save('{"x":3}', token),
  ]);
  expect(results.map((result) => (result as { kind: string }).kind).sort()).toEqual([
    "conflict",
    "written",
  ]);
});

test("exclusive create has exactly one winner and preserves its exact candidate", async () => {
  const results = await Promise.all([save("  {}\r\n"), save('{"b":2}')]);
  expect(results.map((result) => result.kind).sort()).toEqual(["conflict", "written"]);
  const written = results.find((result) => result.kind === "written")!;
  if (written.kind !== "written") throw Error("missing winner");
  expect(await readFile(path(), "utf8")).toBe(written.snapshot.rawContent);
  expect(written.snapshot.metadata.versionToken?.value).toBe(digest(written.snapshot.rawContent));
});

test("one read supplies both raw text and hash even if disk changes immediately afterward", async () => {
  await writeFile(path(), '{"x":1}');
  let reads = 0;
  const result = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* openSettingsDocument({ documentId, mode: "file" }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFile: (file) =>
            fs.readFile(file).pipe(
              Effect.tap(() => {
                reads++;
                return fs.writeFileString(file, '{"x":9}');
              }),
            ),
        }),
      );
    }),
  );
  expect(reads).toBe(1);
  expect(result.rawContent).toBe('{"x":1}');
  expect(result.metadata.versionToken?.value).toBe(digest(result.rawContent));
  expect(await readFile(path(), "utf8")).toBe('{"x":9}');
});

test("permission failures are not absence and cannot authorize creation", async () => {
  const error = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "readFile",
  });
  await expect(
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* saveSettingsDocument({
          documentId,
          mode: "file",
          rawContent: "{}",
          expected: { kind: "missing" },
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            readFile: () => Effect.fail(error),
          }),
        );
      }),
    ),
  ).rejects.toMatchObject({ note: expect.stringContaining("PermissionDenied") });
  expect(await readdir(join(productPodsRootPath(), "sample", "settings"))).toEqual([]);
});

test("partial temp write failure cleans only the acquired temp and preserves destination", async () => {
  await writeFile(path(), "original");
  const failure = PlatformError.systemError({
    _tag: "Unknown",
    module: "FileSystem",
    method: "writeAll",
    description: "injected partial write",
  });
  await expect(
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* writeFileStringAtomic(path(), "candidate", "test").pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            open: (file, options) =>
              fs.open(file, options).pipe(
                Effect.map((handle) => ({
                  ...handle,
                  writeAll: (bytes) =>
                    handle
                      .writeAll(bytes.subarray(0, 2))
                      .pipe(Effect.andThen(Effect.fail(failure))),
                })),
              ),
          }),
        );
      }),
    ),
  ).rejects.toMatchObject({ note: expect.stringContaining("injected partial write") });
  expect(await readFile(path(), "utf8")).toBe("original");
  expect(await readdir(join(productPodsRootPath(), "sample", "settings"))).toEqual(["file.json"]);
});

test("wx acquisition collision is never removed by cleanup", async () => {
  let collision = "";
  await expect(
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* writeFileStringAtomic(path(), "candidate", "test").pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            open: (file, options) =>
              Effect.gen(function* () {
                collision = file;
                yield* fs.writeFileString(file, "foreign");
                return yield* fs.open(file, options);
              }),
          }),
        );
      }),
    ),
  ).rejects.toBeDefined();
  expect(await readFile(collision, "utf8")).toBe("foreign");
});

test("host rejects cross-address open and create before touching another file", async () => {
  await writeFile(path(), "{}");
  const workspaceId = (await open()).metadata.workspaceId;
  const other = { ...documentId, relativePath: "b.json" };
  await expect(
    run(openSettingsDocument({ documentId: other, workspaceId, mode: "file" })),
  ).rejects.toMatchObject({ note: expect.stringContaining("another Work") });
  await expect(
    run(
      saveSettingsDocument({
        documentId: other,
        workspaceId,
        mode: "file",
        rawContent: "{}",
        expected: { kind: "missing" },
      }),
    ),
  ).rejects.toMatchObject({ note: expect.stringContaining("another Work") });
  expect(await readdir(join(productPodsRootPath(), "sample", "settings"))).toEqual(["file.json"]);
});

test("independent Work runtimes saving one reviewed file meet the same host semaphore", async () => {
  await writeFile(path(), '{"x":1}');
  const scope = { route: "settings", target: null, work: (await open()).metadata.workspaceId };
  const bridge = {
    invoke: () => {
      throw new Error("No Revit allowed");
    },
  } as unknown as RevitBridge["Service"];
  vi.spyOn(HostRpcCaller.prototype, "call").mockImplementation(
    async (key, request) =>
      (await Effect.runPromise(
        dispatchTsOnlyOperation(
          key as "settings.document.open" | "settings.document.save",
          request,
          undefined,
          bridge,
        ).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici)),
      )) as never,
  );
  const make = () => {
    const rows = new Map<string, unknown>();
    return new RouteWorkspace({
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
  };
  const runtimes = [make(), make()];
  for (const [index, runtime] of runtimes.entries()) {
    expect((await runtime.command(scope, "settings", "human", "open", { documentId }, 0)).ok).toBe(
      true,
    );
    expect(
      (
        await runtime.apply(
          scope,
          "settings",
          "human",
          [{ path: ["fields", "/x", "staged"], value: { value: index + 2 } }],
          1,
        )
      ).ok,
    ).toBe(true);
  }
  const results = await Promise.all(
    runtimes.map(async (runtime, index) => {
      const owner = new ActionJournal(join(directory, `actions-${index}.json`));
      await admitFamilyAction(
        {
          id: `save-${index}`,
          key: "settings.write",
          kind: "workflow" as const,
          actor: "human",
          destination: { kind: "host" },
          input: {
            path: path(),
            documentId,
            workspaceId: scope.work,
            write: { kind: "save", versionToken: digest('{"x":1}') },
          },
          bases: { work: { key: scope, revision: 2 } },
        },
        owner,
        new TakeoffCaptures(join(directory, "captures")),
        bridge,
        { workspace: runtime },
      );
      return owner.wait(`save-${index}`);
    }),
  );
  expect(results.map((result) => result.state).sort()).toEqual(["failed", "succeeded"]);
});

test("invalid UTF-8 bytes and unpaired text surrogates refuse without replacement", async () => {
  await writeFile(path(), new Uint8Array([0xff, 0xfe]));
  await expect(open()).rejects.toMatchObject({ note: expect.stringContaining("not valid UTF-8") });
  await rm(path());
  await expect(save("\uD800")).rejects.toMatchObject({
    note: expect.stringContaining("unpaired surrogates"),
  });
  expect(await readdir(join(productPodsRootPath(), "sample", "settings"))).toEqual([]);
});
