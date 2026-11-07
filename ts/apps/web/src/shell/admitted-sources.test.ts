import { expect, test } from "vite-plus/test";
import { module } from "../shell/admitted-module.test-fixture";
import generated from "../captures/source-closure.generated.json";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { admittedSources } from "./admitted-sources";
async function admit(sources: Record<string, unknown>) {
  const candidate = { ...module, sources };
  const envelope = {
    ...generated.envelope,
    source: "builtin-closure" as const,
    version: 1 as const,
    data: RouteGraphJson.parse(module.data),
    variants: [{ client: "web" as const, entry: generated.envelope.variants[0]!.entry }],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    witness: {
      module: candidate,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const admission = await inventory.prepare("witness", fingerprint);
  return { admission, candidate };
}
test("admission supplies Captures sources without application enrollment", async () => {
  for (const sources of [module.sources]) {
    const { admission, candidate } = await admit(sources);
    const result = admission.admit(candidate);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    const resolved = admittedSources(result.route);
    expect(Object.keys(resolved)).toEqual(Object.keys(sources));
    for (const key of Object.keys(sources)) {
      const actual = resolved[key]!;
      expect(actual.kind).toBe("use");
      if (actual.kind === "use")
        expect(actual.open).toBe((sources as Record<string, { open: unknown }>)[key]!.open);
    }
    expect(() => admittedSources({ ...result.route } as any)).toThrow();
  }
});
test("replacement source functions cannot reuse the loaded admission", async () => {
  const { admission, candidate } = await admit(module.sources);
  const replaced = { ...candidate, sources: { "captures.list": { kind: "use", open() {} } } };
  expect(admission.admit(replaced).ok).toBe(false);
});


test("mutating a source object cannot replace the loader-captured executable", async () => {
  const original = module.sources["captures.list"]!;
  if (original.kind !== "use") throw Error("Expected an ordinary source");
  const source = { ...original };
  const { admission, candidate } = await admit({ "captures.list": source });
  source.open = () => {};
  expect(admission.admit(candidate).ok).toBe(false);
});
