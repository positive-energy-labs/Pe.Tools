import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPackages } from "../src/packages.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { createPodRoutes } from "../src/pod-routes.ts";
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

test("route installation pins exact bytes, changed bytes lose trust, disable removes access", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-route-trust-"));
  const pods = join(root, "Pods");
  const folder = join(pods, "renamed");
  const entry = "routes/tool/index.js";
  await mkdir(join(folder, "routes/tool"), { recursive: true });
  await writeFile(
    join(folder, "pod.json"),
    JSON.stringify({
      id: "sample",
      routes: [{ sourcePath: entry, name: "Tool", description: "An explicit route" }],
    }),
  );
  await writeFile(
    join(folder, entry),
    "export function create(){ return function Tool() { return null; }; }",
  );
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(pods),
    decisionsPath: join(root, "plugins.json"),
  });
  const workspace = new RouteWorkspace({
    registrations: [],
    store: fileRouteDocumentStore(join(root, "work")),
  });
  const scope = { binding: "host" as const, route: "pod.sample.tool", target: null };
  const routes = createPodRoutes(lifecycle, {
    trustPath: join(root, "route-trust.json"),
    workspace,
  });
  try {
    const [first] = await routes.list();
    expect(first).toMatchObject({
      key: "route:@sample/routes/tool/index.js",
      workRoute: "pod.sample.tool",
      trusted: false,
    });
    await expect(routes.bundle(first!.key, first!.sha256)).rejects.toThrow("trust");
    await expect(routes.trust(first!.key, "0".repeat(64), true)).rejects.toThrow("changed");
    await routes.trust(first!.key, first!.sha256, true);
    expect((await workspace.view(scope, scope.route))?.doc).toEqual({ version: 1, state: {} });
    expect(
      (
        await workspace.apply(
          scope,
          scope.route,
          "human",
          [{ path: ["state"], value: { amps: 24 } }],
          0,
        )
      ).ok,
    ).toBe(true);
    expect(await routes.bundle(first!.key, first!.sha256)).toContain("export function create");
    const reopened = createPodRoutes(lifecycle, { trustPath: join(root, "route-trust.json") });
    expect((await reopened.list())[0]!.trusted).toBe(true);
    await writeFile(
      join(folder, entry),
      "export function create(){ return function Changed() { return null; }; }",
    );
    expect((await routes.list())[0]!.trusted).toBe(false);
    expect(await workspace.view(scope, scope.route)).toBeNull();
    await expect(routes.bundle(first!.key, first!.sha256)).rejects.toThrow();
    const [changed] = await routes.list();
    await routes.trust(changed!.key, changed!.sha256, true);
    expect((await workspace.view(scope, scope.route))?.doc).toEqual({
      version: 1,
      state: { amps: 24 },
    });
    await lifecycle.setEnabled("pod:sample", false);
    expect(await routes.list()).toEqual([]);
    expect(await workspace.view(scope, scope.route)).toBeNull();
    await expect(routes.bundle(changed!.key, changed!.sha256)).rejects.toThrow();
  } finally {
    await lifecycle.close();
    await rm(root, { recursive: true, force: true });
  }
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
