import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const ts = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
const imports = (source: string) =>
  [...source.matchAll(/(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g)].map(
    ([, names, specifier]) => ({ names: names!, specifier: specifier! }),
  );

describe("contracts <- runtime <- surface adapters", () => {
  it("keeps lower packages independent of MCP and app adapters", () => {
    const violations: string[] = [];
    for (const name of ["host-contracts", "agent-contracts", "runtime"]) {
      const directory = join(ts, "packages", name);
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const forbidden = (specifier: string) =>
        /^@pe\/(?:mcps|host|web)(?:\/|$)/.test(specifier) ||
        /(?:^|\/)apps\/(?:host|web)(?:\/|$)/.test(specifier) ||
        /(?:^|\/)mcps(?:\/|$)/.test(specifier) ||
        (name !== "runtime" &&
          (/^@pe\/runtime(?:\/|$)/.test(specifier) || /(?:^|\/)runtime(?:\/|$)/.test(specifier)));
      for (const dependency of Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      })) {
        if (forbidden(dependency)) violations.push(`${name}: dependency ${dependency}`);
      }
      for (const path of files(join(directory, "src"))) {
        for (const { specifier } of imports(readFileSync(path, "utf8"))) {
          if (forbidden(specifier)) violations.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("makes the host obtain invocation scope and runtime capabilities below MCP", () => {
    const violations: string[] = [];
    for (const path of files(join(ts, "apps/host/src"))) {
      for (const { names, specifier } of imports(readFileSync(path, "utf8"))) {
        const mcp = /^@pe\/mcps(?:\/|$)/.test(specifier) || specifier.includes("packages/mcps/");
        if (
          mcp &&
          (/invocation-context|\/context$/.test(specifier) ||
            /\b(?:PeaRuntimeCapabilities|InvocationContext|RequestPrincipal)\b/.test(names))
        )
          violations.push(`${path}: ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
