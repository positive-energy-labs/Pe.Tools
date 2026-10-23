import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web/src/components/lang");
export const langImports: Record<string, string> = {
  pane: "pane",
  "pane-resize": "pane-resize",
  "pane-strip": "pane-strip",
  floater: "floater",
  help: "tooltip",
  label: "input",
  textarea: "input",
  "command-palette": "list-popup",
  "cell-key": "cell",
  kbd: "key-hint",
  outcome: "outcome",
  surface: "surface",
  section: "section",
  switcher: "switcher",
  switch: "switch",
  "switch-row": "switch-row",
  dialog: "dialog",
  "value-diff": "value-diff",
  accordion: "accordion",
  activity: "activity",
  "coverage-bar": "coverage-bar",
  "arming-strip": "arming-strip",
};

// Rewrite quoted module paths, including relative imports left in sibling branches.
// This deliberately leaves CSS paths alone: navigation.css still belongs to web.
export function rewrite(source: string, file: string): string {
  let next = source.replace(
    /(["'])([^"'\r\n]+)\1/g,
    (literal: string, quote: string, specifier: string) => {
      let name = specifier.startsWith("#/components/lang/")
        ? specifier.slice("#/components/lang/".length)
        : undefined;
      if (specifier.startsWith(".")) {
        const path = resolve(dirname(file), specifier);
        if (dirname(path) === web) name = relative(web, path).split(sep).join("/");
      }
      return name !== undefined && name in langImports
        ? `${quote}@pe/kit/lang/${langImports[name]}${quote}`
        : literal;
    },
  );
  if (/from ["']@pe\/kit\/lang\/key-hint["']/.test(next))
    next = next.replace(/\bKbd\b/g, "KeyHint");
  if (/from ["']@pe\/kit\/lang\/tooltip["']/.test(next))
    next = next.replace(/\bHelpTip\b/g, "TooltipHint");
  next = next
    .replace(/@pe\/kit\/lang\/pane-tabs\b/g, "@pe/kit/lang/switcher")
    .replace(/\bPaneTabs\b/g, "Switcher");
  for (const module of new Set(Object.values(langImports))) {
    const pattern = new RegExp(
      `import\\s*\\{([^}]+)\\}\\s*from\\s*["']@pe/kit/lang/${module}["'];`,
      "g",
    );
    const imports = [...next.matchAll(pattern)];
    if (imports.length < 2) continue;
    const names = [
      ...new Set(
        imports.flatMap((match) =>
          match[1]
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ),
    ];
    let first = true;
    next = next.replace(pattern, () => {
      if (!first) return "";
      first = false;
      return `import { ${names.join(", ")} } from "@pe/kit/lang/${module}";`;
    });
  }
  return next;
}

function walk(dir: string): number {
  let changed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".vite", ".output"].includes(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      changed += walk(file);
      continue;
    }
    if (!/\.(?:tsx?|mjs)$/.test(entry.name) || file === fileURLToPath(import.meta.url)) continue;
    const source = readFileSync(file, "utf8");
    const next = rewrite(source, file);
    if (source !== next) {
      writeFileSync(file, next);
      changed++;
    }
  }
  return changed;
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  console.log(
    `lang imports: ${walk(join(root, "apps")) + walk(join(root, "packages"))} files changed`,
  );
