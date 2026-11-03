import { readFile } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import { catalogEntries } from "../../../../packages/agent-contracts/src/pe-api.ts";
import { loadRouteArtifact, type RouteArtifactBytes } from "./route-artifact.ts";

test("Snowdon's shipped artifact admits and refuses tampering before evaluation", async () => {
  const root = new URL("../../../../../examples/pods/snowdon-circuits/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("pod.json", root), "utf8"));
  expect(manifest.routes).toHaveLength(1);
  const row = manifest.routes[0];
  const artifact: RouteArtifactBytes = JSON.parse(
    await readFile(new URL(row.artifact, root), "utf8"),
    (key, value) => (key === "bytes" && Array.isArray(value) ? Uint8Array.from(value) : value),
  );
  expect(`pod-bytes:${artifact.fingerprint}`).toBe(row.fingerprint);
  let evaluations = 0;
  const evaluate = (bytes: Uint8Array) => {
    evaluations++;
    return import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`
    );
  };
  const loaded = await loadRouteArtifact(artifact, catalogEntries, evaluate);
  expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
  if (loaded.ok) expect(loaded.route.workFingerprint).toBe(row.fingerprint);
  artifact.executables[0]!.members[0]!.bytes[0] ^= 1;
  await expect(loadRouteArtifact(artifact, catalogEntries, evaluate)).rejects.toThrow(
    "bytes or fingerprint differ",
  );
  expect(evaluations).toBe(1);
});
