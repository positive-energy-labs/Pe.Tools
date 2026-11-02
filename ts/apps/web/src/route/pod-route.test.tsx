// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import {
  podRouteDescriptorSchema,
  validatePodSource,
  validatePodDeclaration,
} from "@pe/agent-contracts";
import * as contracts from "@pe/agent-contracts";
import { z } from "zod";
vi.mock("./builtin-routes", () => ({ publicRoutes: { entries: () => [] } }));
import { makePodRoute } from "./pod-view";
test("pipes authors a document route with versioned typed Work through the common mount", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const bytes = await readFile(
    (await import("node:path")).resolve(
      process.cwd(),
      "../../../examples/pods/pipes/routes/pipes/index.js",
    ),
  );
  const bundle = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
  const row = podRouteDescriptorSchema.parse({
    key: "route:@pipes/routes/pipes/index.js",
    packageId: "pipes",
    workRoute: "pod.pipes.pipes",
    name: "Pipes",
    description: "Piping systems",
    sourcePath: "routes/pipes/index.js",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    trusted: true,
  });
  const mounted = makePodRoute(row, bundle);
  expect(mounted.graph.needs).toBe("document");
  expect(mounted.graph.subjectField.keyKind).toBe("UniqueId");
  expect(mounted.graph.work?.parse({})).toMatchObject({ version: 3, writeIntent: {} });
  expect(typeof mounted.hosted).toBe("function");
});

test("Pod catalog readings refresh through the shared receipt invalidation mechanism", async () => {
  const { createReadingGraph } = await import("#/shell/readings");
  const { podRead } = await import("./pod-sources");
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const bytes = await readFile(
    resolve(process.cwd(), "../../../examples/pods/pipes/routes/pipes/index.js"),
  );
  const bundle = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
  const { graph, adapters } = makePodRoute(
    podRouteDescriptorSchema.parse({
      key: "route:@pipes/routes/pipes/index.js",
      packageId: "pipes",
      workRoute: "pod.pipes.pipes",
      name: "Pipes",
      description: "Piping systems",
      sourcePath: "routes/pipes/index.js",
      sha256: "a".repeat(64),
      trusted: true,
    }),
    bundle,
  );
  let value = "P-0";
  const read = vi.spyOn(podRead, "run").mockImplementation(async () => ({ value }));
  const target = { kind: "document" as const, ref: { session: "fixture", openId: "pipes" } };
  const readings = createReadingGraph(graph, {
    sources: adapters.sources,
    log() {},
    scope: {
      target,
      workKey: null,
      workRevision: 1,
      page: { system: "pipe-system-1" },
      work: { version: 3, writeIntent: {} },
    },
  });
  const release = readings.mount(["pod.pipes.detail"]);
  try {
    await waitFor(() => expect(readings.get("pod.pipes.detail").value).toEqual({ value: "P-0" }));
    value = "P-1";
    readings.acceptReceipt(
      {
        id: "fixture-apply",
        state: "succeeded",
        target,
        effects: [{ kind: "document", ref: target.ref }],
      },
      ["snapshot"],
    );
    await waitFor(() => expect(readings.get("pod.pipes.detail").value).toEqual({ value: "P-1" }));
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    release();
    readings.dispose();
    read.mockRestore();
  }
});

for (const name of ["pipes/routes/pipes", "snowdon-circuits/routes/voltage-drop"]) {
  test(`${name} has one registration and refuses state ownership, empty draws and missing Work`, async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const bytes = await readFile(resolve(process.cwd(), `../../../examples/pods/${name}/index.js`));
    validatePodSource(bytes.toString());
    const bundle = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
    expect(Object.keys(bundle)).toEqual(["register"]);
    const [packageId, , source] = name.split("/");
    const row = podRouteDescriptorSchema.parse({
      key: `route:@${name}/index.js`,
      packageId,
      workRoute: `pod.${packageId}.${source}`,
      name: source,
      description: "Test",
      sourcePath: `routes/${source}/index.js`,
      sha256: "a".repeat(64),
      trusted: true,
    });
    makePodRoute(row, bundle);
    const declaration = () => bundle.register({ ...contracts, z, descriptor: row });
    const missing = declaration();
    delete missing.work;
    expect(() => validatePodDeclaration(missing)).toThrow("Work schema");
    const empty = declaration();
    (Object.values(empty.graph.panes).find((p: any) => !p.history) as { draws: string[] }).draws =
      [];
    expect(() => validatePodDeclaration(empty)).toThrow("draws");
    expect(() => validatePodSource("api.React.useState(null)")).toThrow("kernel props");
  });
}

test("pipes kernel owns subject selection and stages the exact typed Work input", async () => {
  const { createFixtureMount } = await import("#/shell/fixture");
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const bytes = await readFile(
    resolve(process.cwd(), "../../../examples/pods/pipes/routes/pipes/index.js"),
  );
  const bundle = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
  const row = podRouteDescriptorSchema.parse({
    key: "route:@pipes/routes/pipes/index.js",
    packageId: "pipes",
    workRoute: "pod.pipes.pipes",
    name: "Pipes",
    description: "Test",
    sourcePath: "routes/pipes/index.js",
    sha256: "a".repeat(64),
    trusted: true,
  });
  const { graph, adapters } = makePodRoute(row, bundle);
  const owner = await createFixtureMount(graph, "sample", adapters);
  const disconnect = owner.connect();
  try {
    owner.view.setPage({ system: "pipe-system-1" });
    const edit = { elementId: 12, parameterId: 42, value: "P-1", expected: {} };
    expect((await owner.control("intent", JSON.stringify(edit)).run()).state).toBe("done");
    expect((await owner.control("stage", {}).run()).state).toBe("done");
    expect(owner.snapshot().work?.doc.writeIntent["pod.pipes.set-parameter"].edit.value).toEqual(
      edit,
    );
    expect(owner.view.read().page.system).toBe("pipe-system-1");
  } finally {
    disconnect();
    owner.dispose();
  }
});
