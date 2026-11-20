import { readdir, realpath, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { catalogSchema, type CatalogTable } from "@pe/ducts-domain/catalog";
import { ductCatalogReadingSchema } from "@pe/ducts-contract/duct-catalog";
import type { z } from "zod";
import { Effect } from "effect";
import { documentRefSchema } from "@pe/agent-contracts";
import type { HomeFiles } from "@pe/host-internal/home-files";
import { leaf } from "@pe/host-internal/read-graph";
import { productPathNames } from "@pe/host-contracts/contracts";
import { type Home } from "@pe/host-contracts/product-paths";
import { read as readStoredFile, homeKind, type HomeRoot } from "@pe/host-contracts/kinds";
const catalogKind = homeKind({
  schema: catalogSchema,
  place: (_library: string, id: string) => `Catalog ${id}`,
  segments: (library: string, id: string) => [library, id, "catalog.json"],
});

export type CatalogReading = z.infer<typeof ductCatalogReadingSchema>;
/** The catalogs' own contract: a recorded input decodes only if it is still that input. */
export const catalogReading = ductCatalogReadingSchema.strict();
/** The `catalogs` home as a read input: every tier's catalogs for the target's project home. */
export const catalogs = leaf("file:catalogs", documentRefSchema.nullable(), catalogReading);
/**
 * The home's reader for the kernel: every product that declares the `catalogs` home hands this to
 * `implement()`. The recorded name predates the home's, and recordings pin it.
 */
export const catalogsHome = {
  name: "duct-catalogs",
  schema: catalogReading,
  read: (homes: readonly Home[], bindHome: (home: Home) => HomeRoot) =>
    readDuctCatalogs(homes, bindHome),
};
/** The same input for a command, which holds the files service and the project pointer. */
export const catalogsFor = (files: HomeFiles["Service"], pointer?: string | null) =>
  Effect.map(files.home("catalogs", pointer), (value) => catalogReading.parse(value));

/**
 * The `catalogs` home's reader body. Read-only portable units, no registration and no product-home
 * creation on a missing root. A table id is unique across every catalog in every home: an id
 * claimed twice admits no table, with a finding. Nothing shadows. Each table carries its home's tier as the home list (`list`: user, project, firm) gave it, the only source of a tier (D8), and its file.
 */
export async function readDuctCatalogs(
  list: readonly Home[],
  bindHome: (home: Home) => HomeRoot,
): Promise<CatalogReading> {
  const tables: Record<string, CatalogTable> = Object.create(null);
  const findings: string[] = [];
  const duplicates = new Set<string>();
  for (const home of list) await readCatalogsFolder(bindHome(home), tables, duplicates, findings);
  return { tables, findings };
}

async function readCatalogsFolder(
  home: HomeRoot,
  tables: Record<string, CatalogTable>,
  duplicates: Set<string>,
  findings: string[],
) {
  const root = join(home.root, productPathNames.catalogsDirectoryName);
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
        catalogKind.in(home, productPathNames.catalogsDirectoryName, folder.name),
      );
      if (read.kind !== "ok")
        throw Error(read.kind === "missing" ? "catalog.json is missing" : read.reason);
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
        } else
          tables[table.id] = {
            ...table,
            home: { tier: home.tier, file: join(dir, "catalog.json") },
          };
      }
    } catch (error) {
      findings.push(`${folder.name}: ${String(error)}`);
    }
  }
}
