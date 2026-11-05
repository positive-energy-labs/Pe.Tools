/**
 * The host's file inputs (ADR 0031 rule 1): the firm file and the duct catalogs. A body reads them
 * through this service so a test or a recording can answer instead of the disk. Provenance stays
 * in each reading: the firm says present or why not, the catalogs carry their findings, and a
 * recording keeps both exactly as they were read.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { catalogTableSchema, ductsFirmSchema } from "@pe/agent-contracts";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { readDuctCatalogs, productCatalogsRootPath, type CatalogReading } from "./duct-catalogs.ts";
import { firmFilePath, readFirm, type FirmReading } from "./ducts-inputs.ts";
import {
  captureInput,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
} from "./native-recording.ts";

// The readings' own contracts: a recorded firm or catalog decodes only if it is still that reading.
const firmReading = z.strictObject({
  firm: ductsFirmSchema,
  path: z.string(),
  present: z.boolean(),
  error: z.string().optional(),
});
const catalogReading = z.strictObject({
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

export class HostFiles extends Context.Service<
  HostFiles,
  {
    readonly firm: Effect.Effect<FirmReading, DoorFailure>;
    readonly ductCatalogs: Effect.Effect<CatalogReading, DoorFailure>;
  }
>()("pe/HostFiles") {
  static readonly layer = (
    roots: { readonly firm: string; readonly catalogs: string } = {
      firm: firmFilePath(),
      catalogs: productCatalogsRootPath(),
    },
  ) =>
    Layer.succeed(HostFiles, {
      firm: Effect.promise(() => readFirm(roots.firm)),
      ductCatalogs: Effect.promise(() => readDuctCatalogs(roots.catalogs)),
    });
  /** The live files, each read kept as a taking: absence, fallback and findings included. */
  static readonly capturing = (writer: RecordingWriter) =>
    Layer.effect(
      HostFiles,
      Effect.map(Effect.service(HostFiles), (live) => ({
        firm: captureInput(writer, FIRM, SCOPE, firmCodec, live.firm),
        ductCatalogs: captureInput(writer, CATALOGS, SCOPE, catalogsCodec, live.ductCatalogs),
      })),
    );
  /** Recorded files only: a miss refuses, and neither the disk nor the firm seed is read. */
  static readonly recorded = (reader: RecordingReader) =>
    Layer.succeed(HostFiles, {
      firm: replayInput(reader, FIRM, SCOPE, firmCodec),
      ductCatalogs: replayInput(reader, CATALOGS, SCOPE, catalogsCodec),
    });
}

/** Under /pe so the dev proxy carries it; a bare /ducts/* belongs to the web route (404 in Vite). */
export const ductCatalogsRoute = HttpRouter.add(
  "GET",
  "/pe/ducts/catalogs",
  Effect.gen(function* () {
    const files = yield* HostFiles;
    return HttpServerResponse.jsonUnsafe(yield* files.ductCatalogs);
  }),
);
