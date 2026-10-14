import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { withInvocationContext } from "@pe/mcps/context";
import { human } from "./callers.ts";
import { createContributionContent } from "../src/pe-routes.ts";
import { createPluginsHandler } from "../src/plugins-handler.ts";
import { bindPackageLifecycle, requirePackageEnabled } from "../src/package-lifecycle.ts";
import { listPackages } from "../src/packages.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { freezeScript } from "../src/operation-script.ts";
import { readMember } from "../src/settings.ts";
import { servePeRoute } from "@pe/agent-contracts/pe-api";
import { importPod, exportPod, writeZip } from "../src/pod-transfer.ts";

let root = "";
afterEach(async () => {
  bindPackageLifecycle(undefined);
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

test("import into a running production-root lifecycle activates Pages and retains export membership", async () => {
  root = await mkdtemp(join(tmpdir(), "pe-plugin-running-import-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  vi.stubEnv("LOCALAPPDATA", join(root, "machine"));
  const content = createContributionContent({ worldRoot: root });
  bindPackageLifecycle(content.lifecycle);
  await content.read();
  const files = new Map<string, Buffer>([
    ["pod.json", Buffer.from('{"id":"imported"}')],
    ["pages/tour/index.html", Buffer.from("<title>Imported</title>")],
  ]);
  const archivePath = join(root, "input.zip");
  await writeFile(archivePath, writeZip(files));
  await importPod({ archivePath });
  const pages = createPagesHandler(join(root, "Pages"), join(root, "Pods"));
  expect((await pages(new Request("http://host/pages/imported--tour/"))).status).toBe(200);
  const exported = await exportPod({ pod: "imported", archivePath: join(root, "export.zip") });
  expect(exported.members.map((m) => m.path)).toEqual(["pages/tour/index.html", "pod.json"]);
  expect(content.lifecycle.inventory().find((p) => p.id === "pod:imported")?.status).toBe("active");
  await content.lifecycle.setEnabled("pod:imported", false);
  expect((await pages(new Request("http://host/pages/imported--tour/"))).status).toBe(404);
  await content.lifecycle.close();
});
test("public disable removes Page, script, member, catalog and receipted skill; re-enable restores bytes", async () => {
  root = await mkdtemp(join(tmpdir(), "pe-plugin-integration-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  vi.stubEnv("LOCALAPPDATA", join(root, "machine"));
  const pods = join(root, "Pods");
  const bytes = {
    "pod.json": '{"id":"sample","entrypoints":[{"sourcePath":"src/Run.cs"}]}',
    "src/Run.cs": "class Run {}",
    "pages/tour/index.html": "<title>Tour</title>",
    "skills/inspect/SKILL.md": "Inspect",
    "settings/input.json": "{}",
  };
  for (const [path, text] of Object.entries(bytes)) {
    await mkdir(join(pods, "sample", path, ".."), { recursive: true });
    await writeFile(join(pods, "sample", path), text);
  }
  const content = createContributionContent({
    worldRoot: root,
    packages: () => listPackages(pods),
  });
  bindPackageLifecycle(content.lifecycle);
  const manage = createPluginsHandler(content);
  const pages = createPagesHandler(join(root, "Pages"), pods);
  const before = await content.read();
  expect(before.packages.map((p) => p.id)).toEqual(["sample"]);
  expect((await pages(new Request("http://host/pages/sample--tour/"))).status).toBe(200);
  const toggle = (enabled: boolean) =>
    withInvocationContext({ caller: human }, () =>
      servePeRoute(
        new Request("http://host/pe/plugins/pod%3Asample", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        }),
        manage,
      ),
    );
  expect((await toggle(false)).status).toBe(200);
  expect((await content.read()).packages).toEqual([]);
  expect(content.member("member:sample/settings/input.json")).toBeUndefined();
  expect((await pages(new Request("http://host/pages/sample--tour/"))).status).toBe(404);
  const sourceBundle = {
    files: Object.entries(bytes).map(([path, text]) => ({
      path,
      bytesBase64: Buffer.from(text).toString("base64"),
    })),
  };
  await expect(freezeScript({ sourcePath: "src/Run.cs", sourceBundle })).rejects.toThrow(
    "inactive",
  );
  await expect(
    Effect.runPromise(readMember({ pod: "sample", path: "settings/input.json" })),
  ).rejects.toThrow("inactive");
  expect((await content.read()).skills.some((s) => s.package.id === "sample")).toBe(false);
  expect((await toggle(true)).status).toBe(200);
  expect((await content.read()).skills.some((s) => s.package.id === "sample")).toBe(true);
  expect((await pages(new Request("http://host/pages/sample--tour/"))).status).toBe(200);
  expect(await readFile(join(pods, "sample", "src/Run.cs"), "utf8")).toBe(bytes["src/Run.cs"]);
  await mkdir(join(pods, "new", "pages/tour"), { recursive: true });
  await writeFile(join(pods, "new/pod.json"), '{"id":"new"}');
  await writeFile(join(pods, "new/pages/tour/index.html"), "new");
  await expect(requirePackageEnabled("new")).rejects.toThrow("inactive");
  expect((await pages(new Request("http://host/pages/new--tour/"))).status).toBe(404);
  await content.lifecycle.close();
});

test("captured plugin module activates hooks, file removal removes influence", async () => {
  root = await mkdtemp(join(tmpdir(), "pe-plugin-hook-"));
  vi.stubEnv("LOCALAPPDATA", join(root, "machine"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  const pods = join(root, "Pods");
  await mkdir(join(pods, "hook/plugins/observe"), { recursive: true });
  await writeFile(join(pods, "hook/pod.json"), '{"id":"hook"}');
  await writeFile(
    join(pods, "hook/plugins/observe/index.js"),
    'export default {setup(c){ c.hook("turn.before", e => { globalThis.__peHookSeen = e.turnId; }); }}',
  );
  const { createPackageLifecycle } = await import("../src/package-lifecycle.ts");
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(pods),
    decisionsPath: join(root, "plugins.json"),
  });
  bindPackageLifecycle(lifecycle);
  await lifecycle.ready;
  expect(lifecycle.inventory().find((p) => p.id === "pod:hook")?.status).toBe("active");
  await mkdir(join(pods, "broken/plugins/observe"), { recursive: true });
  await writeFile(join(pods, "broken/pod.json"), '{"id":"broken"}');
  await writeFile(
    join(pods, "broken/plugins/observe/index.js"),
    'export default { setup(){throw Error("setup failure");} }',
  );
  await lifecycle.refresh();
  await lifecycle.setEnabled("pod:broken", true);
  expect(lifecycle.inventory().find((p) => p.id === "pod:broken")).toMatchObject({
    status: "error",
    error: expect.stringContaining("setup failure"),
  });
  await expect(requirePackageEnabled("broken")).rejects.toThrow("inactive");
  await lifecycle.emit("turn.before", { threadId: "t", turnId: "one" });
  expect((globalThis as unknown as { __peHookSeen: string }).__peHookSeen).toBe("one");
  await rm(join(pods, "hook"), { recursive: true });
  await lifecycle.refresh();
  await lifecycle.emit("turn.before", { threadId: "t", turnId: "two" });
  expect((globalThis as unknown as { __peHookSeen: string }).__peHookSeen).toBe("one");
  delete (globalThis as unknown as { __peHookSeen?: string }).__peHookSeen;
  await lifecycle.close();
});
