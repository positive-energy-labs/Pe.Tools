import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPackages } from "../src/packages.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { createPodRoutes, podCommand } from "../src/pod-routes.ts";
import { peRoutes, peRouteUrl } from "@pe/agent-contracts/pe-api";
import { admitRequest } from "../src/control.ts";
import { human, pea } from "./callers.ts";
import { RouteWorkspace } from "@pe/runtime";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

test("only an administrator may trust executable routes; a document grant does not install code", () => {
  const rule = peRoutes["plugins.routeTrust"];
  const door = peRouteUrl("plugins.routeTrust", {
    params: { key: "route:@sample/routes/tool/index.js" },
  });
  expect(rule.permission).toBe("admin");
  expect(() => admitRequest(human, rule.permission, door)).not.toThrow();
  expect(() => admitRequest(pea(), rule.permission, door)).toThrow();
  expect(() =>
    admitRequest(human, rule.permission, door, { paired: true, allowAdministration: false }),
  ).toThrow();
});

test("undeclared modules and malformed route declarations never become executable contributions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-route-admission-"));
  try {
    await mkdir(join(root, "sample/routes/tool"), { recursive: true });
    await writeFile(
      join(root, "sample/routes/tool/index.js"),
      "throw Error('must not run in host')",
    );
    await writeFile(join(root, "sample/pod.json"), '{"id":"sample"}');
    expect((await listPackages(root)).packages[0]!.contributions).toEqual([]);
    await writeFile(
      join(root, "sample/pod.json"),
      JSON.stringify({
        id: "sample",
        routes: [
          { sourcePath: "pages/tour/index.html", name: "HTML is not a route", description: "" },
        ],
      }),
    );
    const pod = (await listPackages(root)).packages[0]!;
    expect(pod.diagnostics.some((d) => d.code === "InvalidRoute")).toBe(true);
    expect(pod.contributions.some((c) => c.kind === "route")).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the pipes module is admitted from its trusted runtime member and deactivation withdraws its commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipes-runtime-"));
  const folder = join(root, "Pods/pipes");
  await mkdir(join(folder, "routes/pipes"), { recursive: true });
  for (const name of ["pod.json", "routes/pipes/index.js"])
    await writeFile(
      join(folder, name),
      await readFile(new URL(`../../../../examples/pods/pipes/${name}`, import.meta.url)),
    );
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(join(root, "Pods")),
    decisionsPath: join(root, "enabled.json"),
  });
  const workspace = new RouteWorkspace({
    registrations: [],
    store: fileRouteDocumentStore(join(root, "Work")),
  });
  const routes = createPodRoutes(lifecycle, {
    workspace,
    bridge: {} as never,
    trustPath: join(root, "trust.json"),
  });
  try {
    const [route] = await routes.list();
    expect(podCommand("pod.pipes.set-parameter")).toBeUndefined();
    await routes.trust(route!.key, route!.sha256, true);
    expect(podCommand("pod.pipes.set-parameter")).toBeDefined();
    await lifecycle.setEnabled("pod:pipes", false);
    expect(podCommand("pod.pipes.set-parameter")).toBeUndefined();
    expect(await routes.list()).toEqual([]);
  } finally {
    routes.close();
    await lifecycle.close();
    await rm(root, { recursive: true, force: true });
  }
});
