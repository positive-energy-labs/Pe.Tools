// The codegen that produced contracts/product.ts is deleted; the mirror is hand-maintained.
// This test is the sync gate: every `public const string` in the mirrored C# classes must appear
// in the TS object (camelCase) with an identical value. TS-only extras are tolerated (tracked
// separately as dead-constant cleanup), C#-side drift is not. The INSTALLED LAYOUT is not mirrored
// here at all — product.payloads.json is its single authority.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import {
  hostProcessIdentity,
  productIdentity,
  productPathNames,
  scriptingWorkspaceIdentity,
} from "@pe/host-contracts/contracts";

const sourceDir = fileURLToPath(new URL("../../../../dotnet/", import.meta.url));

type ConstMap = Record<string, string>;

/** Parse `public const string Name = <"literal" | Class.Ref | Ref>;` declarations per class. */
function parseCsharpConsts(fileNames: readonly string[]): Record<string, ConstMap> {
  const raw: Record<string, Record<string, { literal?: string; ref?: string }>> = {};
  for (const fileName of fileNames) {
    const source = readFileSync(`${sourceDir}${fileName}`, "utf8");
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
  "Pe.Shared.Product/ProductIdentity.cs",
  "Pe.Shared.Product/ProductPathNames.cs",
  "Pe.Shared.Product/ScriptingWorkspaceLayout.cs",
  "Pe.Shared.HostContracts/Transport/HostEndpoint.cs",
]);

const mirrors: readonly {
  csharpClass: string;
  ts: Record<string, unknown>;
  /** C# const name → TS key, where the mirror deliberately renamed. */
  aliases?: Record<string, string>;
}[] = [
  { csharpClass: "ProductIdentity", ts: productIdentity },
  { csharpClass: "ProductPathNames", ts: productPathNames },
  { csharpClass: "HostEndpoint", ts: hostProcessIdentity },
  { csharpClass: "ScriptingWorkspaceLayout", ts: scriptingWorkspaceIdentity },
];

test("contracts/product.ts mirrors the C# product and host-endpoint constants", () => {
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

// Third mirror leg: the product manifest is the deployment authority for the host service, so its
// host payload's name/health/shutdown must equal the same contract constants. After this, every
// host identity string is SDK-owned, mirror-tested, or generated.
const manifestUrl = new URL("../../../../product.payloads.json", import.meta.url);

test("product.payloads.json host payload mirrors the host service contract", () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8")) as {
    payloads: { type: string; name: string; service?: { health?: string; shutdown?: string } }[];
  };
  const host = manifest.payloads.find((p) => p.type === "VersionedApp" && p.name === "host");
  expect(host, "no VersionedApp host payload in product.payloads.json").toBeTruthy();
  expect(host!.name).toBe(hostProcessIdentity.serviceName);
  expect(host!.service?.health).toBe(hostProcessIdentity.healthPath);
  expect(host!.service?.shutdown).toBe(hostProcessIdentity.shutdownPath);
});

test("pea dev shim pins the workspace package manager", () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8")) as {
    payloads: { type: string; name: string; dev?: string }[];
  };
  const workspace = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
  ) as { packageManager: string };
  const pea = manifest.payloads.find((p) => p.type === "PathShim" && p.name === "pea");
  expect(pea?.dev).toBe(
    `corepack ${workspace.packageManager} --dir "{root}/ts" --filter @pe/pea pea`,
  );
});
