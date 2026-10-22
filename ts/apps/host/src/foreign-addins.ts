import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { productRoot } from "@pe/host-contracts/service-identity";

type ProductManifest = {
  years?: string[];
  legacy?: string[];
  payloads?: { type: string; name: string }[];
};
/** `Autodesk\Revit\Addins` per user and per machine, and the `Autodesk` roots holding `Revit <year>\AddIns`. */
export type AddinRoots = { user: string; machine: string; programFiles: string[] };

/**
 * Pe.Tools add-in manifests Revit can load that are not this install's own: counts and years only.
 * Candidates follow the SDK's legacy rule (MsiCommand `ComposeLegacyRemoval`): a manifest `legacy`
 * entry `addins:*\/<Name>` or `allusersaddins:*\/<Name>` names `<Addins>\<year>\<Name>.addin`, plus
 * the add-in payload's own name and its 0.6.x `00-<Name>.addin` shim. The one manifest that is this
 * product is the per-user `<year>\<Name>.addin` whose `<Assembly>` lies inside `<year>\<Name>\`.
 */
function foreignAddins(manifest: ProductManifest, roots: AddinRoots) {
  const addin = manifest.payloads?.find((p) => p.type === "VersionedAddin")?.name;
  const named = (scope: string) =>
    (manifest.legacy ?? []).flatMap((spec) => {
      const m = /^(addins|allusersaddins):\*\/([^/]+)$/.exec(spec);
      return m?.[1] === scope ? [m[2]!] : [];
    });
  const own = addin ? [addin] : [];
  const years = new Set<string>();
  let count = 0;
  for (const year of manifest.years ?? []) {
    const ownDir = addin ? join(roots.user, year, addin) : null;
    const candidates = new Set([
      ...[...named("addins"), ...own, ...own.map((n) => `00-${n}`)].map((n) =>
        join(roots.user, year, `${n}.addin`),
      ),
      ...[...named("allusersaddins"), ...own].flatMap((n) => [
        join(roots.machine, year, `${n}.addin`),
        ...roots.programFiles.map((root) => join(root, `Revit ${year}`, "AddIns", `${n}.addin`)),
      ]),
    ]);
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const assembly = /<Assembly>\s*([^<]+?)\s*<\/Assembly>/i.exec(
        readFileSync(path, "utf8"),
      )?.[1];
      const target = assembly ? resolve(dirname(path), assembly).toLowerCase() : "";
      if (
        ownDir &&
        path === `${ownDir}.addin` &&
        target.startsWith(`${ownDir}${sep}`.toLowerCase())
      )
        continue;
      count++;
      years.add(year);
    }
  }
  return { foreignAddinCount: count, foreignAddinYears: [...years] };
}

/** The installed host's boot census; an unreadable manifest or folder reports nothing, never fails boot. */
export function installedForeignAddins() {
  try {
    const manifest = JSON.parse(
      readFileSync(join(productRoot(), "product.payloads.json"), "utf8"),
    ) as ProductManifest;
    const env = process.env;
    return foreignAddins(manifest, {
      user: join(env.APPDATA ?? "", "Autodesk", "Revit", "Addins"),
      machine: join(env.ProgramData ?? "C:\\ProgramData", "Autodesk", "Revit", "Addins"),
      programFiles: [env.ProgramFiles, env["ProgramFiles(x86)"]].flatMap((root) =>
        root ? [join(root, "Autodesk")] : [],
      ),
    });
  } catch {
    return {};
  }
}
