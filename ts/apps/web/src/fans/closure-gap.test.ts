import { expect, test } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBuiltinClosure, fingerprintRouteSource } from "../../route-source-hash";
import { module as captures } from "../captures/kernel";
import { builtinClosureFingerprint } from "../../../../packages/agent-contracts/src/route-module";

test("the builtin closure producer preserves supplied owner evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-w1c-closure-"));
  try {
    const entry = join(root, "module.ts");
    await writeFile(entry, "export const route = 'fans';\n");
    const workOwner = {
      route: "ducts",
      fingerprint: await builtinClosureFingerprint({
        source: "builtin-closure",
        version: 1,
        data: captures.data,
        hostVersion: "w1c-owner-fixture",
        variants: [{ client: "web", entry: "owner.ts" }],
        modules: [{ id: "owner.ts", sha256: "a".repeat(64) }],
        inputs: [],
        externals: [],
      }),
    };
    const options = {
      root,
      identityRoot: root,
      variants: [{ client: "web" as const, entry }],
      data: {
        ...captures.data,
        key: "fans",
        address: "/fans",
        capabilities: ["work"],
        work: { route: "ducts" },
      },
      hostVersion: "w1c-fixture",
      inputs: [],
      workOwner,
    };
    const closure = await buildBuiltinClosure(options);
    expect(closure.envelope.workOwner).toEqual(workOwner);
    expect(closure.fingerprint).toBe(fingerprintRouteSource(closure.envelope));
    expect(closure.fingerprint).toBe(fingerprintRouteSource({ ...closure.envelope, workOwner }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
