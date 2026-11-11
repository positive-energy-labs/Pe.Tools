/**
 * The host's file inputs (ADR 0031 rule 1): the firm files and the duct catalogs. A body reads them
 * through this service so a test or a recording can answer instead of the disk. A firm file is
 * kept as read (absent, unreadable, or its JSON); `ctx.firm` decodes it against the owner's schema
 * and seed, so the recording holds the input, never a derived fallback.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { existsSync, watch } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { catalogTableSchema, ductsFirmSchema } from "@pe/agent-contracts";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { sharedFirmDir } from "@pe/host-contracts/product-paths";
import { readDuctCatalogs, productCatalogsRoots, type CatalogReading } from "./duct-catalogs.ts";
import { firmFileSchema, firmOwner, type FirmFile } from "./reads/evaluator.ts";
import {
  captureInput,
  inputBindingKey,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
  type TakingObserver,
} from "./native-recording.ts";

/**
 * Slice 2b (ADR 0035 rule 11): firm files are a shared setting with no user layer, at
 * `<shared>/Firm/<owner>.json` (ducts' is `<shared>/Firm/ducts.json`); null without a shared root.
 */
export const firmRootPath = (): string | null => sharedFirmDir();
/** One owner's firm file as read; malformed JSON is a visible error, never a thrown defect. */
async function readFirmFile(root: string | null, owner: string): Promise<FirmFile> {
  // No shared root: the file has no home, so the read refuses rather than seeding silently.
  if (root === null) return { refused: "no-shared-root" };
  const path = join(root, `${firmOwner.parse(owner)}.json`);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path };
    return { path, error: String(error) };
  }
  try {
    return { path, json: JSON.parse(text) };
  } catch (error) {
    return { path, error: String(error) };
  }
}
const readFirmRoot = async (root: string | null) => {
  if (root === null) return [];
  const names = await readdir(root).catch(() => [] as string[]);
  const owners = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  return Promise.all(owners.filter((owner) => firmOwner.safeParse(owner).success).map((owner) => readFirmFile(root, owner)));
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
export const catalogReading = z.strictObject({
  tables: z.record(z.string(), catalogTableSchema),
  findings: z.array(z.string()),
});
const firmCodec = Schema.declare((u): u is FirmFile => firmFileSchema.safeParse(u).success);
const catalogsCodec = Schema.declare(
  (u): u is CatalogReading => catalogReading.safeParse(u).success,
);
const FIRM = { kind: "files", file: "firm" } as const;
const CATALOGS = { kind: "files", file: "duct-catalogs" } as const;
// A file input has no document: its scope is the host's product root, and a firm file's its owner.
const SCOPE = "{}";
const firmScope = (owner: string) => JSON.stringify({ owner });

export class DuctFiles extends Context.Service<
  DuctFiles,
  {
    readonly firm: (owner: string) => Effect.Effect<FirmFile, DoorFailure>;
    readonly ductCatalogs: Effect.Effect<CatalogReading, DoorFailure>;
    readonly subscribe?: (changed: (name: string) => void) => () => void;
  }
>()("pe/DuctFiles") {
  static readonly layer = (
    roots: { readonly firm: string | null; readonly catalogs: string | readonly string[] } = {
      firm: firmRootPath(),
      catalogs: productCatalogsRoots(),
    },
  ) =>
    Layer.succeed(DuctFiles, {
      firm: (owner) => Effect.promise(() => readFirmFile(roots.firm, owner)),
      ductCatalogs: Effect.promise(() => readDuctCatalogs(roots.catalogs)),
      subscribe: (changed) => {
        const stops = [
          // No shared root, no firm file to watch: the refusal holds until the host restarts.
          ...(roots.firm === null ? [] : [["firm", roots.firm] as const]),
          ...[roots.catalogs].flat().map((path) => ["catalogs", path] as const),
        ].map(
          ([name, path]) => {
            // A filesystem hint (including an ancestor change) is not a changed input.
            // Compare the producer's answer so absent files and access metadata stay quiet.
            const read =
              name === "firm" ? () => readFirmRoot(roots.firm) : () => readDuctCatalogs(roots.catalogs);
            let closed = false;
            let previous = read().then((value) => JSON.stringify(value));
            const refresh = () => {
              previous = previous.then(async (before) => {
                if (closed) return before;
                const next = JSON.stringify(await read());
                if (!closed && next !== before) changed(name);
                return next;
              });
            };
            // Watch an existing ancestor: absence, directory creation and atomic replacement still notify.
            let base = dirname(resolve(path));
            while (!existsSync(base) && dirname(base) !== base) base = dirname(base);
            const watcher = watch(base, { recursive: true, persistent: false }, (_event, file) => {
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
            });
            watcher.on("error", () => changed(name));
            return () => {
              closed = true;
              watcher.close();
            };
          },
        );
        return () => stops.forEach((stop) => stop());
      },
    });
  /** The live files, each read kept as a taking: absence, fallback and findings included. */
  static readonly capturing = (writer: RecordingWriter, observed?: TakingObserver) =>
    Layer.effect(
      DuctFiles,
      Effect.map(Effect.service(DuctFiles), (live) => ({
        subscribe: live.subscribe,
        firm: (owner) =>
          captureInput(writer, FIRM, firmScope(owner), firmCodec, live.firm(owner), observed),
        ductCatalogs: captureInput(
          writer,
          CATALOGS,
          SCOPE,
          catalogsCodec,
          live.ductCatalogs,
          observed,
        ),
      })),
    );
  /** Recorded files only: a miss refuses, and neither the disk nor the firm seed is read. */
  static readonly recorded = (
    reader: RecordingReader,
    bindings: ReadonlyMap<string, string> = new Map(),
  ) =>
    Layer.succeed(DuctFiles, {
      firm: (owner) =>
        replayInput(
          reader,
          FIRM,
          firmScope(owner),
          firmCodec,
          bindings.get(inputBindingKey(FIRM, firmScope(owner))),
        ),
      ductCatalogs: replayInput(
        reader,
        CATALOGS,
        SCOPE,
        catalogsCodec,
        bindings.get(inputBindingKey(CATALOGS, SCOPE)),
      ),
    });
}

/** Under /pe so the dev proxy carries it; a bare /ducts/* belongs to the web route (404 in Vite). */
export const ductCatalogsRoute = HttpRouter.add(
  "GET",
  "/pe/ducts/catalogs",
  Effect.gen(function* () {
    const files = yield* DuctFiles;
    return HttpServerResponse.jsonUnsafe(yield* files.ductCatalogs);
  }),
);
