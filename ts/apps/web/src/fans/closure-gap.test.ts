import { expect, test } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBuiltinClosure, fingerprintRouteSource } from "../../route-source-hash";
import { module as captures } from "../shell/admitted-module.test.fixture";

test("the builtin closure producer hashes fans without another route", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-w1c-closure-"));
  try {
    const entry = join(root, "module.ts");
    await writeFile(entry, "export const route = 'fans';\n");
    const options = {
      root,
      identityRoot: root,
      variants: [{ client: "web" as const, entry }],
      data: {
        ...captures.data,
        key: "fans",
        address: "/fans",
        capabilities: ["work"],
        work: { route: "fans", schema: "work", version: 1, },
      },
      hostVersion: "w1c-fixture",
      inputs: [],
    };
    const closure = await buildBuiltinClosure(options);
    expect(closure.envelope.data.work?.route).toBe("fans");
    expect(closure.fingerprint).toBe(fingerprintRouteSource(closure.envelope));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
