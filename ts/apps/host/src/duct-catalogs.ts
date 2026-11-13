import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, relative, isAbsolute } from "node:path";
import { catalogSchema, type Catalogs, type CatalogTable } from "@pe/ducts-domain/catalog";
import { productPathNames } from "@pe/host-contracts/contracts";
import { homeDirs } from "@pe/host-contracts/product-paths";
import { read as readStoredFile, homeKind } from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";
  const catalogKind = homeKind({
  schema: catalogSchema,
  place: (_library: string, id: string) => `Catalog ${id}`,
  segments: (library: string, id: string) => [library, id, "catalog.json"],
});

/** The product's Catalogs in every home, in list order (user, project, firm). */
export const productCatalogsRoots = (pointer?: string | null) => homeDirs(productPathNames.catalogsDirectoryName, { pointer });
export interface CatalogReading {
  tables: Catalogs;
  findings: string[];
}

/**
 * The `DuctFiles` layer body. Read-only portable units, no registration and no product-home
 * creation on a missing root. A table id is unique across every catalog in every home: an id
 * claimed twice admits no table, with a finding. Nothing shadows.
 */
export async function readDuctCatalogs(
  roots: string | readonly string[] = productCatalogsRoots(),
): Promise<CatalogReading> {
  const tables: Record<string, CatalogTable> = Object.create(null);
  const findings: string[] = [];
  const duplicates = new Set<string>();
  for (const root of [roots].flat()) await readCatalogsFolder(root, tables, duplicates, findings);
  return { tables, findings };
}

async function readCatalogsFolder(
  root: string,
  tables: Record<string, CatalogTable>,
  duplicates: Set<string>,
  findings: string[],
) {
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
      // Authored (ADR 0039): a catalog that does not decode is refused and kept, with its reason.
      const read = readStoredFile(
        catalogKind.in(
          hostState().home({ root: dirname(root), tier: "user" }),
          basename(root),
          folder.name,
        ),
      );
      if (read.kind !== "ok") throw Error(read.kind === "missing" ? "catalog.json is missing" : read.reason);
      const catalog = read.value;
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
}
