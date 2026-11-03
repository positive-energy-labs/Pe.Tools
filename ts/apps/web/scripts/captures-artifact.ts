import { createJiti } from "jiti";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { buildRouteArtifact } =
  await jiti.import<typeof import("../route-module-hash.ts")>("../route-module-hash.ts");
const { capturesData } = await jiti.import<typeof import("../src/captures/kernel.ts")>(
  "../src/captures/kernel.ts",
);
const contract = await readFile(
  new URL("../../../packages/agent-contracts/src/route-kernel-data.ts", import.meta.url),
);
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const artifact = await buildRouteArtifact({
  entry: fileURLToPath(new URL("../src/captures/kernel.ts", import.meta.url)),
  data: capturesData,
  contracts: [{ id: "capture-kernel-v1", bytes: new Uint8Array(contract) }],
});
const destination = new URL("../src/captures/artifact.generated.json", import.meta.url);
const text =
  JSON.stringify(artifact, (_k, v) =>
    v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v,
  ) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== text)
    throw Error("Captures artifact stale; run scripts/captures-artifact.ts");
} else await writeFile(destination, text);
