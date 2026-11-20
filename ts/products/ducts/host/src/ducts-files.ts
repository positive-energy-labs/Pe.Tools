import { leaf } from "@pe/host-internal/read-graph";
import { documentRefSchema } from "@pe/agent-contracts";
/**
 * The host's file inputs (ADR 0031 rule 1): the firm files and the duct catalogs. A body reads them
 * through this service so a test or a recording can answer instead of the disk. A firm file is
 * kept as read (absent, unreadable, or its JSON); `ctx.firm` decodes it against the owner's schema
 * and seed, so the recording holds the input, never a derived fallback.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { z } from "zod";
import { existsSync, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ductCatalogReadingSchema } from "@pe/ducts-contract/duct-catalog";
import { ductsFirmSchema } from "@pe/ducts-contract/duct-inputs";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { firmSettingsDir, homes, type Home } from "@pe/host-contracts/product-paths";
import type { HomeRoot } from "@pe/host-contracts/kinds";
import { productPathNames } from "@pe/host-contracts/contracts";
import { readDuctCatalogs, type CatalogReading } from "./duct-catalogs.ts";
import { firmFileSchema, firmOwner, type FirmFile } from "@pe/host-internal/reads/evaluator";
import { readSettingsFile } from "@pe/host-internal/settings-files";
import {
  captureInput,
  inputBindingKey,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
  type TakingObserver,
} from "@pe/host-internal/input-recording";

/**
 * Firm files are the firm tier of a tiered value (ADR 0037 rule 8), at `<firm home>/Settings/<owner>.json`
 * (ducts' is `Settings/ducts.json`); null on a machine with no firm home.
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

// The decoded ducts layer, and the catalogs' own contract: a recorded input decodes only if it is still that input.
export const firmReading = z.union([
  z.strictObject({
    firm: ductsFirmSchema,
    path: z.string(),
    present: z.boolean(),
    error: z.string().optional(),
  }),
  z.strictObject({ refused: z.literal("no-shared-root") }),
]);
export const catalogReading = ductCatalogReadingSchema.strict();
const firmCodec = Schema.declare((u): u is FirmFile => firmFileSchema.safeParse(u).success);
const catalogsCodec = Schema.declare(
  (u): u is CatalogReading => catalogReading.safeParse(u).success,
);
const FIRM = { kind: "files", file: "firm" } as const;
const CATALOGS = { kind: "files", file: "duct-catalogs" } as const;
// A catalog taking names its project pointer; a document-free taking keeps the host-root scope.
const SCOPE = "{}";
const catalogScope = (pointer?: string | null) => (pointer ? JSON.stringify({ pointer }) : SCOPE);
const firmScope = (owner: string) => JSON.stringify({ owner });

export class DuctFiles extends Context.Service<
  DuctFiles,
  {
    readonly firm: (owner: string) => Effect.Effect<FirmFile, DoorFailure>;
    readonly catalogsFor: (
      pointer: string | null | undefined,
    ) => Effect.Effect<CatalogReading, DoorFailure>;
    readonly subscribe?: (changed: (name: string) => void) => () => void;
  }
>()("pe/DuctFiles") {
  static readonly layer = (
    bindHome: (home: Home) => HomeRoot,
    roots: {
      readonly firm: string | null | (() => string | null);
      readonly catalogs: readonly Home[];
    } = {
      firm: firmRootPath,
      catalogs: homes(),
    },
  ) => {
    const firmRoot = () => (typeof roots.firm === "function" ? roots.firm() : roots.firm);
    return Layer.succeed(DuctFiles, {
      firm: (owner) => Effect.sync(() => readFirmFile(firmRoot(), owner)),
      catalogsFor: (pointer) =>
        Effect.promise(() =>
          readDuctCatalogs(pointer ? homes({ pointer }) : roots.catalogs, bindHome),
        ),
      subscribe: (changed) => {
        const stops = [
          ["firm", firmRoot()] as const,
          ...roots.catalogs.map(
            (home) =>
              ["catalogs", join(home.root, productPathNames.catalogsDirectoryName)] as const,
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
              : () => readDuctCatalogs(roots.catalogs, bindHome);
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
      DuctFiles,
      Effect.map(Effect.service(DuctFiles), (live) => ({
        subscribe: live.subscribe,
        catalogsFor: (pointer) =>
          captureInput(
            writer,
            CATALOGS,
            catalogScope(pointer),
            catalogsCodec,
            catalogsFor(live, pointer),
            observed,
          ),
        firm: (owner) =>
          captureInput(writer, FIRM, firmScope(owner), firmCodec, live.firm(owner), observed),
      })),
    );
  /** Recorded files only: a miss refuses, and neither the disk nor the firm seed is read. */
  static readonly recorded = (
    reader: RecordingReader,
    bindings: ReadonlyMap<string, string> = new Map(),
  ) =>
    Layer.succeed(DuctFiles, {
      catalogsFor: (pointer) =>
        replayInput(
          reader,
          CATALOGS,
          catalogScope(pointer),
          catalogsCodec,
          bindings.get(inputBindingKey(CATALOGS, catalogScope(pointer))),
        ),
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

export const catalogsFor = (files: DuctFiles["Service"], pointer?: string | null) =>
  files.catalogsFor(pointer);

export const catalogs = leaf("file:catalogs", documentRefSchema.nullable(), catalogReading);
