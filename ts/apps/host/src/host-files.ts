/**
 * The host's file inputs (ADR 0031 rule 1): the firm file and the duct catalogs. A body reads them
 * through this service so a test or a recording can answer instead of the disk. Provenance stays
 * in each reading: the firm says present or why not, the catalogs carry their findings.
 */
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { readDuctCatalogs, productCatalogsRootPath, type CatalogReading } from "./duct-catalogs.ts";
import { firmFilePath, readFirm, type FirmReading } from "./ducts-inputs.ts";

export class HostFiles extends Context.Service<
  HostFiles,
  {
    readonly firm: Effect.Effect<FirmReading>;
    readonly ductCatalogs: Effect.Effect<CatalogReading>;
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
