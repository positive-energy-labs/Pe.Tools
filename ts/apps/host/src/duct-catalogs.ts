import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { catalogSchema, type Catalogs, type CatalogTable } from "@pe/ducts-domain/catalog";
import { contentDirs } from "./content-homes.ts";

/** The product's Catalogs in every content home, read in order (user first). */
export const productCatalogsRoots = () => contentDirs("Catalogs");
export interface CatalogReading {
  tables: Catalogs;
  findings: string[];
}

/**
 * The `DuctFiles` layer body. Read-only portable units, no registration and no product-home
 * creation on a missing root. Across homes the user's catalog shadows a shared one: a folder name
 * or table id an earlier root admitted (or refused as a duplicate) is skipped in a later root.
 */
export async function readDuctCatalogs(
  roots: string | readonly string[] = productCatalogsRoots(),
): Promise<CatalogReading> {
  const tables: Record<string, CatalogTable> = Object.create(null);
  const findings: string[] = [];
  const shadowed = new Set<string>();
  const folders = new Set<string>();
  for (const root of [roots].flat()) {
    const reading = await readCatalogsFolder(root, folders);
    for (const [id, table] of Object.entries(reading.tables)) if (!shadowed.has(id)) tables[id] = table;
    for (const id of [...Object.keys(reading.tables), ...reading.duplicates]) shadowed.add(id);
    findings.push(...reading.findings);
  }
  return { tables, findings };
}

async function readCatalogsFolder(root: string, claimed: Set<string>) {
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
    if (claimed.has(folder.name.toLowerCase())) continue;
    claimed.add(folder.name.toLowerCase());
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
  return { tables, findings, duplicates };
}
