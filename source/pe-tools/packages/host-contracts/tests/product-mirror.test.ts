// The codegen that produced contracts/product.ts is deleted; the mirror is hand-maintained.
// This test is the sync gate: every `public const string` in the mirrored Pe.Shared.Product
// classes must appear in the TS object (camelCase) with an identical value. TS-only extras are
// tolerated (tracked separately as dead-constant cleanup), C#-side drift is not.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import {
  hostProcessIdentity,
  peaCliIdentity,
  productIdentity,
  productPathNames,
  revitDeploymentIdentity,
  scriptingWorkspaceIdentity,
} from "@pe/host-contracts/contracts";

const sharedProductDir = fileURLToPath(new URL("../../../../Pe.Shared.Product/", import.meta.url));

type ConstMap = Record<string, string>;

/** Parse `public const string Name = <"literal" | Class.Ref | Ref>;` declarations per class. */
function parseCsharpConsts(fileNames: readonly string[]): Record<string, ConstMap> {
  const raw: Record<string, Record<string, { literal?: string; ref?: string }>> = {};
  for (const fileName of fileNames) {
    const source = readFileSync(`${sharedProductDir}${fileName}`, "utf8");
    for (const classMatch of source.matchAll(/(?:class|record)\s+(\w+)[^{]*\{([\s\S]*?)^\}/gm)) {
      const [, className, body] = classMatch;
      const consts: Record<string, { literal?: string; ref?: string }> = (raw[className] ??= {});
      for (const constMatch of body.matchAll(
        /public const string (\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([\w.]+))\s*;/g,
      )) {
        const [, name, literal, ref] = constMatch;
        consts[name] = literal !== undefined ? { literal } : { ref };
      }
    }
  }
  const resolve = (className: string, name: string, depth = 0): string => {
    const entry = raw[className]?.[name];
    if (!entry) throw new Error(`Unresolvable C# const ${className}.${name}`);
    if (entry.literal !== undefined) return entry.literal;
    if (depth > 5) throw new Error(`Const reference cycle at ${className}.${name}`);
    const [refClass, refName] = entry.ref!.includes(".")
      ? (entry.ref!.split(".") as [string, string])
      : [className, entry.ref!];
    return resolve(refClass, refName, depth + 1);
  };
  return Object.fromEntries(
    Object.entries(raw).map(([className, consts]) => [
      className,
      Object.fromEntries(Object.keys(consts).map((name) => [name, resolve(className, name)])),
    ]),
  );
}

const csharp = parseCsharpConsts([
  "ProductIdentity.cs",
  "ProductPathNames.cs",
  "HostProcessIdentity.cs",
  "PeaCliIdentity.cs",
  "RevitDeploymentIdentity.cs",
  "ScriptingWorkspaceLayout.cs",
]);

const mirrors: readonly {
  csharpClass: string;
  ts: Record<string, unknown>;
  /** C# const name → TS key, where the mirror deliberately renamed. */
  aliases?: Record<string, string>;
}[] = [
  { csharpClass: "ProductIdentity", ts: productIdentity },
  { csharpClass: "ProductPathNames", ts: productPathNames },
  { csharpClass: "HostProcessIdentity", ts: hostProcessIdentity },
  {
    csharpClass: "PeaCliIdentity",
    ts: peaCliIdentity,
    aliases: { ExecutableName: "installedExecutableName" },
  },
  { csharpClass: "RevitDeploymentIdentity", ts: revitDeploymentIdentity },
  { csharpClass: "ScriptingWorkspaceLayout", ts: scriptingWorkspaceIdentity },
];

test("contracts/product.ts mirrors Pe.Shared.Product string constants", () => {
  for (const { csharpClass, ts, aliases } of mirrors) {
    const consts = csharp[csharpClass];
    expect(consts, `parsed no consts for ${csharpClass}`).toBeTruthy();
    expect(Object.keys(consts).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(consts)) {
      const tsKey = aliases?.[name] ?? name.charAt(0).toLowerCase() + name.slice(1);
      expect(ts[tsKey], `${csharpClass}.${name} missing from product.ts as '${tsKey}'`).toBe(value);
    }
  }
});
