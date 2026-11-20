/**
 * The host's file inputs (ADR 0031 rule 1): the firm files, and each home a product reads itself. A
 * body reads them through this service so a test or a recording can answer instead of the disk. A
 * firm file is kept as read (absent, unreadable, or its JSON); `ctx.firm` decodes it against the
 * owner's schema and seed, so the recording holds the input, never a derived fallback.
 */
import { Context, Effect, Layer, Schema } from "effect";
import type { z } from "zod";
import { existsSync, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { DoorFailure } from "./request-contracts.d.ts";
import { firmSettingsDir, homes, type Home } from "@pe/host-contracts/product-paths";
import type { HomeRoot } from "@pe/host-contracts/kinds";
import { firmFileSchema, firmOwner, type FirmFile } from "./reads/evaluator.ts";
import { readSettingsFile } from "./settings-files.ts";
import {
  captureInput,
  inputBindingKey,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
  type TakingObserver,
} from "./input-recording.ts";

/**
 * A home whose files the kernel cannot read as cells: its product's reader, given every tier's
 * home. `implement()` takes one for each declared home file that names no cell path.
 */
export type HomeReader<T = unknown> = {
  /** The recorded input name. Recordings pin it, so it does not follow a rename of the home. */
  readonly name: string;
  readonly schema: z.ZodType<T>;
  readonly read: (homes: readonly Home[], bindHome: (home: Home) => HomeRoot) => Promise<T>;
};
type Declared = HomeReader & { readonly directory: string };
const readers = new Map<string, Declared>();
/** Called by `implement()`. Products that declare one shared home hand over its one reader. */
export function declareHome(home: string, reader: Declared) {
  const held = readers.get(home);
  if (held && held.read !== reader.read) throw Error(`Home '${home}' already has a reader`);
  readers.set(home, reader);
}
export const isProductHome = (home: string) => readers.has(home);
const declared = (home: string) => {
  const reader = readers.get(home);
  if (!reader) throw Error(`Home '${home}' has no reader on this host`);
  return {
    ...reader,
    input: { kind: "files", file: reader.name } as const,
    // A recorded input decodes only if it is still that input.
    codec: Schema.declare((u): u is unknown => reader.schema.safeParse(u).success),
  };
};

/**
 * Firm files are the firm tier of a tiered value (ADR 0037 rule 8), at
 * `<firm home>/Settings/<owner>.json`; null on a machine with no firm home.
 */
export const firmRootPath = (): string | null => firmSettingsDir();
/** One owner's firm file, through the one settings-file reader (`tiered-settings.ts`); a malformed file is a visible error. */
function readFirmFile(root: string | null, owner: string): FirmFile {
  // No firm home: the file has no home, so the read refuses rather than seeding silently.
  if (root === null) return { refused: "no-shared-root" };
  const path = join(root, `${firmOwner.parse(owner)}.json`);
  const { sha256: _sha256, ...file } = readSettingsFile(path);
  return { path, ...file };
}
const readFirmRoot = async (root: string | null) => {
  if (root === null) return [];
  const names = await readdir(root).catch(() => [] as string[]);
  const owners = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  return Promise.all(
    owners
      .filter((owner) => firmOwner.safeParse(owner).success)
      .map((owner) => readFirmFile(root, owner)),
  );
};

const firmCodec = Schema.declare((u): u is FirmFile => firmFileSchema.safeParse(u).success);
const FIRM = { kind: "files", file: "firm" } as const;
// A home taking names its project pointer; a document-free taking keeps the host-root scope.
const SCOPE = "{}";
const homeScope = (pointer?: string | null) => (pointer ? JSON.stringify({ pointer }) : SCOPE);
const firmScope = (owner: string) => JSON.stringify({ owner });

export class HomeFiles extends Context.Service<
  HomeFiles,
  {
    readonly firm: (owner: string) => Effect.Effect<FirmFile, DoorFailure>;
    /** A product-read home across every tier, with the project home `pointer` names. */
    readonly home: (
      name: string,
      pointer: string | null | undefined,
    ) => Effect.Effect<unknown, DoorFailure>;
    readonly subscribe?: (changed: (name: string) => void) => () => void;
  }
>()("pe/HomeFiles") {
  static readonly layer = (
    bindHome: (home: Home) => HomeRoot,
    roots: {
      readonly firm: string | null | (() => string | null);
      readonly homes: readonly Home[];
    } = {
      firm: firmRootPath,
      homes: homes(),
    },
  ) => {
    const firmRoot = () => (typeof roots.firm === "function" ? roots.firm() : roots.firm);
    return Layer.succeed(HomeFiles, {
      firm: (owner) => Effect.sync(() => readFirmFile(firmRoot(), owner)),
      home: (name, pointer) =>
        Effect.promise(async () =>
          declared(name).read(pointer ? homes({ pointer }) : roots.homes, bindHome),
        ),
      subscribe: (changed) => {
        const stops = [
          ["firm", firmRoot()] as const,
          ...[...readers].flatMap(([name, { directory }]) =>
            roots.homes.map((home) => [name, join(home.root, directory)] as const),
          ),
        ].map(([name, path]) => {
          // A filesystem hint (including an ancestor change) is not a changed input.
          // Compare the producer's answer so absent files and access metadata stay quiet.
          const read =
            name === "firm"
              ? async () => {
                  const root = firmRoot();
                  return { root, files: await readFirmRoot(root) };
                }
              : () => declared(name).read(roots.homes, bindHome);
          let closed = false;
          let value: string | undefined;
          const failed = (error: unknown) => {
            console.warn(`Could not refresh ${name} files: ${String(error)}`);
            return value;
          };
          let previous = read()
            .then((next) => (value = JSON.stringify(next)))
            .catch(failed);
          let watchedPath = path;
          let watcher: ReturnType<typeof watch> | undefined;
          const refresh = () => {
            previous = previous
              .then(async (before) => {
                if (closed) return before;
                if (name === "firm" && firmRoot() !== watchedPath) bind(firmRoot());
                const next = JSON.stringify(await read());
                if (!closed && next !== before) changed(name);
                return (value = next);
              })
              .catch(failed);
          };
          // Watch an existing ancestor: absence, directory creation and atomic replacement still notify.
          const bind = (path: string | null) => {
            if (path === null) {
              watchedPath = path;
              return;
            }
            let base = dirname(resolve(path));
            while (!existsSync(base) && dirname(base) !== base) base = dirname(base);
            const nextWatcher = watch(
              base,
              { recursive: true, persistent: false },
              (_event, file) => {
                const changedPath = file === null ? null : resolve(base, file.toString());
                const child = changedPath === null ? "" : relative(resolve(path), changedPath);
                const ancestor = changedPath === null ? "" : relative(changedPath, resolve(path));
                if (
                  changedPath === null ||
                  child === "" ||
                  (!child.startsWith(`..${sep}`) && child !== "..") ||
                  (!ancestor.startsWith(`..${sep}`) && ancestor !== "..")
                )
                  refresh();
              },
            );
            nextWatcher.on("error", () => changed(name));
            watcher?.close();
            watcher = nextWatcher;
            watchedPath = path;
          };
          bind(path);
          // A missing drive supplies no filesystem hints. Retry on the firm probe cadence.
          const probe =
            name === "firm"
              ? setInterval(() => {
                  if (firmRoot() !== watchedPath) refresh();
                }, 30_001)
              : undefined;
          probe?.unref();
          return () => {
            closed = true;
            clearInterval(probe);
            watcher?.close();
          };
        });
        return () => stops.forEach((stop) => stop());
      },
    });
  };
  /** The live files, each read kept as a taking: absence, fallback and findings included. */
  static readonly capturing = (writer: RecordingWriter, observed?: TakingObserver) =>
    Layer.effect(
      HomeFiles,
      Effect.map(Effect.service(HomeFiles), (live) => ({
        subscribe: live.subscribe,
        home: (name, pointer) =>
          Effect.suspend(() => {
            const { input, codec } = declared(name);
            return captureInput(
              writer,
              input,
              homeScope(pointer),
              codec,
              live.home(name, pointer),
              observed,
            );
          }),
        firm: (owner) =>
          captureInput(writer, FIRM, firmScope(owner), firmCodec, live.firm(owner), observed),
      })),
    );
  /** Recorded files only: a miss refuses, and neither the disk nor the firm seed is read. */
  static readonly recorded = (
    reader: RecordingReader,
    bindings: ReadonlyMap<string, string> = new Map(),
  ) =>
    Layer.succeed(HomeFiles, {
      home: (name, pointer) =>
        Effect.suspend(() => {
          const { input, codec } = declared(name);
          return replayInput(
            reader,
            input,
            homeScope(pointer),
            codec,
            bindings.get(inputBindingKey(input, homeScope(pointer))),
          );
        }),
      firm: (owner) =>
        replayInput(
          reader,
          FIRM,
          firmScope(owner),
          firmCodec,
          bindings.get(inputBindingKey(FIRM, firmScope(owner))),
        ),
    });
}
