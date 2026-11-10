/**
 * The host's file inputs (ADR 0031 rule 1): the firm file and the duct catalogs. A body reads them
 * through this service so a test or a recording can answer instead of the disk. Provenance stays
 * in each reading: the firm says present or why not, the catalogs carry their findings, and a
 * recording keeps both exactly as they were read.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { existsSync, watch } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { catalogTableSchema, ductsFirmSchema } from "@pe/agent-contracts";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { readDuctCatalogs, productCatalogsRoots, type CatalogReading } from "./duct-catalogs.ts";
import { firmFilePath, readFirm, type FirmReading } from "./ducts-inputs.ts";
import {
  captureInput,
  inputBindingKey,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
  type TakingObserver,
} from "./native-recording.ts";

// The readings' own contracts: a recorded firm or catalog decodes only if it is still that reading.
export const firmReading = z.strictObject({
  firm: ductsFirmSchema,
  path: z.string(),
  present: z.boolean(),
  error: z.string().optional(),
});
export const catalogReading = z.strictObject({
  tables: z.record(z.string(), catalogTableSchema),
  findings: z.array(z.string()),
});
const firmCodec = Schema.declare((u): u is FirmReading => firmReading.safeParse(u).success);
const catalogsCodec = Schema.declare(
  (u): u is CatalogReading => catalogReading.safeParse(u).success,
);
const FIRM = { kind: "files", file: "firm" } as const;
const CATALOGS = { kind: "files", file: "duct-catalogs" } as const;
// A file input has no document: its one scope is the host's product root.
const SCOPE = "{}";

export class DuctFiles extends Context.Service<
  DuctFiles,
  {
    readonly firm: Effect.Effect<FirmReading, DoorFailure>;
    readonly ductCatalogs: Effect.Effect<CatalogReading, DoorFailure>;
    readonly subscribe?: (changed: (name: string) => void) => () => void;
  }
>()("pe/DuctFiles") {
  static readonly layer = (
    roots: { readonly firm: string; readonly catalogs: string | readonly string[] } = {
      firm: firmFilePath(),
      catalogs: productCatalogsRoots(),
    },
  ) =>
    Layer.succeed(DuctFiles, {
      firm: Effect.promise(() => readFirm(roots.firm)),
      ductCatalogs: Effect.promise(() => readDuctCatalogs(roots.catalogs)),
      subscribe: (changed) => {
        const stops = [
          ["firm", roots.firm] as const,
          ...[roots.catalogs].flat().map((path) => ["catalogs", path] as const),
        ].map(
          ([name, path]) => {
            // A filesystem hint (including an ancestor change) is not a changed input.
            // Compare the producer's answer so absent files and access metadata stay quiet.
            const read =
              name === "firm" ? () => readFirm(roots.firm) : () => readDuctCatalogs(roots.catalogs);
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
        firm: captureInput(writer, FIRM, SCOPE, firmCodec, live.firm, observed),
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
      firm: replayInput(reader, FIRM, SCOPE, firmCodec, bindings.get(inputBindingKey(FIRM, SCOPE))),
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
