import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publishPodRoute } from "./pod-route-authoring.ts";
import {
  module,
  data,
  initial,
} from "../../../examples/pods/snowdon-circuits/routes/voltage-drop/module.ts";
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

test("Snowdon publishes deterministic browser and host bytes; tampering either refuses before evaluation", async () => {
  const first = await build();
  const second = await build();
  expect(first.bytes).toEqual(second.bytes);
  expect(first.artifact.artifact.executables).toEqual(JSON.parse(readFileSync(`${root}/routes/voltage-drop/route.artifact`,"utf8")).artifact.executables);
  expect(first.declaration).toEqual(second.declaration);
  expect(podRouteDeclarationSchema.parse(first.declaration)).toEqual(first.declaration);
  const { loadPodRoute } = await import("./src/route/pod-module.ts");
  const { podRouteDescriptorSchema } = await import("@pe/agent-contracts");
  const { loadPodHostEntry, podArtifactSchema } = await import("../host/src/pod-artifact.ts");
  const row = podRouteDescriptorSchema.parse({
    ...first.declaration,
    key: "route:@snowdon-circuits/routes/voltage-drop/route.artifact",
    packageId: "snowdon-circuits",
    workRoute: data.key,
    trusted: true,
  });
  const envelope = {
    fingerprint: row.fingerprint,
    artifact: podArtifactSchema.parse(JSON.parse(new TextDecoder().decode(first.bytes))),
  };
  const loaded = await loadPodRoute(row, envelope, evaluate);
  expect(loaded.fingerprint).toBe(first.declaration.fingerprint);
  expect(first.artifact.executables.map((entry) => entry.client).sort()).toEqual(["host", "web"]);
  const host = await loadPodHostEntry(envelope.artifact, row.fingerprint);
  expect(host.workState?.schema.parse({})).toEqual({ version: 2, inputs: initial });
  for (const client of ["web", "host"]) {
    const changed = structuredClone(envelope);
    changed.artifact.executables.find((entry) => entry.client === client)!.members[0]!.bytes[0]! ^=
      1;
    await expect(loadPodRoute(row, changed, evaluate)).rejects.toThrow("differ");
    await expect(loadPodHostEntry(changed.artifact, row.fingerprint)).rejects.toThrow("differ");
  }
}, 30000);

test("Snowdon computes copper voltage drop only in its tracked host read", async () => {
  const { calculation } =
    await import("../../../examples/pods/snowdon-circuits/routes/voltage-drop/host.ts");
  const { evaluate } = await import("../host/src/reads/evaluator.ts");
  expect(module.host.schemas.work.parse({})).toEqual({ version: 2, inputs: initial });
  const result = await evaluate(
    calculation,
    {},
    {
      evaluation: "snowdon",
      origin: { kind: "test" },
      revision: () => 0,
      take: async (name) => {
        expect(name).toBe("work");
        return { doc: { version: 2, inputs: initial }, revision: 0 };
      },
    },
  );
  expect(result.data.result?.drop).toBeCloseTo((Math.sqrt(3) * 12.9 * 24 * 150) / 10380);
  expect(result.trace.some((entry) => entry.name === "work")).toBe(true);
});
