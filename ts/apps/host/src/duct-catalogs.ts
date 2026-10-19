import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { catalogSchema, type Catalogs, type CatalogTable } from "@pe/ducts-domain/catalog";
import { productUserContentRootPath } from "./product-paths.ts";

export const productCatalogsRootPath = () => join(productUserContentRootPath(), "Catalogs");
export interface CatalogReading {
  tables: Catalogs;
  findings: string[];
}

/** Read-only portable units, no registration and no product-home creation on a missing root. */
export async function readDuctCatalogs(root = productCatalogsRootPath()): Promise<CatalogReading> {
  const tables: Record<string, CatalogTable> = Object.create(null);
  const findings: string[] = [];
  const duplicates = new Set<string>();
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") findings.push(`Catalog root: ${error.message}`);
      return [];
    },
  );
  for (const folder of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!folder.isDirectory() || folder.name.startsWith(".")) continue;
    try {
      const dir = await realpath(join(root, folder.name));
      const catalog = catalogSchema.parse(
        JSON.parse(await readFile(join(dir, "catalog.json"), "utf8")),
      );
      for (const table of catalog.tables) {
        const file = await realpath(resolve(dir, table.source.file));
        const child = relative(dir, file);
        if (child.startsWith("..") || isAbsolute(child) || !(await stat(file)).isFile())
          throw Error(`Source must be a file inside its catalog: ${table.source.file}`);
      }
      for (const table of catalog.tables) {
        if (tables[table.id] || duplicates.has(table.id)) {
          delete tables[table.id];
          duplicates.add(table.id);
          findings.push(`Duplicate catalog table ${table.id}; no table with this id is admitted`);
        } else tables[table.id] = table;
      }
    } catch (error) {
      findings.push(`${folder.name}: ${String(error)}`);
    }
  }
  return { tables, findings };
}

export const ductCatalogsRoute = HttpRouter.add(
  "GET",
  "/ducts/catalogs",
  HttpEffect.fromWebHandler(async () => Response.json(await readDuctCatalogs())),
);
