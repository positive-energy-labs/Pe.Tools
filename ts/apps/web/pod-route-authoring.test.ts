import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publishPodRoute } from "./pod-route-authoring.ts";
import { loadRouteArtifact, type RouteArtifactBytes } from "./src/route/route-artifact.ts";
import {
  module,
  data,
  initial,
  bodies,
} from "../../../examples/pods/snowdon-circuits/routes/voltage-drop/module.ts";
import { linkedCatalog } from "../../packages/agent-contracts/src/pe-api.ts";
import { podRouteDeclarationSchema } from "../../packages/host-contracts/src/pod-route.ts";

const root = fileURLToPath(new URL("../../../examples/pods/snowdon-circuits", import.meta.url));
const build = () =>
  publishPodRoute({
    entry: `${root}/routes/voltage-drop/module.ts`,
    root,
    data,
    slug: "voltage-drop",
    name: data.name,
    description: data.directory.summary,
    contracts: [
      {
        id: "kernel-data",
        bytes: new Uint8Array(
          readFileSync(
            new URL("../../packages/agent-contracts/src/route-kernel-data.ts", import.meta.url),
          ),
        ),
      },
    ],
  });
const evaluate = (bytes: Uint8Array) =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`);
function decode(bytes: Uint8Array): RouteArtifactBytes {
  return JSON.parse(new TextDecoder().decode(bytes), (key, value) =>
    key === "bytes" && Array.isArray(value) ? Uint8Array.from(value) : value,
  );
}

test("Snowdon publishes deterministic exact bytes and admits the decoded package against the catalog", async () => {
  const first = await build();
  const second = await build();
  expect(first.bytes).toEqual(second.bytes);
  expect(first.declaration).toEqual(second.declaration);
  expect(podRouteDeclarationSchema.parse(first.declaration)).toEqual(first.declaration);
  const loaded = await loadRouteArtifact(decode(first.bytes), [...linkedCatalog().entries.values()], evaluate);
  expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
  if (!loaded.ok) throw Error(JSON.stringify(loaded.diagnostics));
  expect(loaded.route.workFingerprint).toBe(first.declaration.fingerprint);
  const changed = decode(first.bytes);
  changed.executables[0]!.members[0]!.bytes[0] ^= 1;
  await expect(loadRouteArtifact(changed, [...linkedCatalog().entries.values()], evaluate)).rejects.toThrow(
    "bytes or fingerprint differ",
  );
}, 30000);

test("Snowdon declares a real v1-to-v2 Work migration and retains the copper calculation", () => {
  expect(data.work.version).toBe(2);
  expect(data.work.migrations).toEqual({ "1": "upgradeV1" });
  expect(bodies.upgradeV1.run({ state: { inputs: { amps: 30 } } })).toEqual({
    version: 2,
    inputs: { ...initial, amps: 30 },
  });
  expect(module.schemas.work.parse({})).toEqual({ version: 2, inputs: initial });
  const result = bodies.calculate.run({
    work: { inputs: initial },
    page: { worksheet: data.fields.worksheet.initial },
    readings: {},
  });
  expect(result.drop).toBeCloseTo((Math.sqrt(3) * 12.9 * 24 * 150) / 10380);
  expect(bodies.show.run(data.fields.worksheet.initial)).toBe("Copper voltage-drop worksheet");
});
