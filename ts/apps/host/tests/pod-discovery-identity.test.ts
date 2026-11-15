import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vite-plus/test";
import { capturePackage, listPackages } from "../src/packages.ts";
import { stopPackageDiscovery } from "../src/pod-capture.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { createContributionContent, createPeRoutes } from "../src/pe-routes.ts";
import { stateTree } from "@pe/host-contracts/service-identity";
import { buildCapabilities } from "@pe/mcps";
import { createHash } from "node:crypto";

const roots: string[] = [];
afterEach(async () => {
  stopPackageDiscovery();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-discovery-identity-"));
  roots.push(root);
  const pods = join(root, "Pods"), second = join(root, "second"), directory = join(pods, "requested");
  await fs.mkdir(join(directory, "pages", "hello"), { recursive: true });
  await fs.mkdir(second);
  await fs.writeFile(join(directory, "pod.json"), '{"id":"requested","entrypoints":[{"sourcePath":"Run.csx"}]}');
  await fs.writeFile(join(directory, "Run.csx"), "Result(1);");
  await fs.writeFile(join(directory, "Helper.cs"), "class Helper { const int V=1; }");
  await fs.writeFile(join(directory, "pages", "hello", "index.html"), "<title>requested</title>");
  const homes = [pods, second];
  await listPackages({ podsRoots: homes });
  return { root, pods, directory, second, homes };
}

// Mutant: refresh identity only when the requested key is absent from the old census.
test("a known by-key capture refuses a newly published cross-home twin on that request", async () => {
  const { second, homes } = await fixture();
  await fs.mkdir(join(second, "twin"));
  await fs.writeFile(join(second, "twin", "pod.json"), '{"id":"requested"}');
  // Owner's no-wait rule uses peer homes' last-published identities.
  await listPackages({ podsRoots: second });
  await expect(capturePackage("requested", homes)).rejects.toThrow(/claimed by|duplicate/i);
});

test("a known by-key capture follows a renamed folder and its Page serves without retry", async () => {
  const { root, pods, directory, homes } = await fixture();
  await fs.rename(directory, join(pods, "renamed-requested"));
  const captured = await capturePackage("requested", homes);
  expect(captured.folder).toBe("renamed-requested");
  expect(captured.sourceBundle.files.find(file => file.path === "Run.csx")?.bytesBase64)
    .toBe(Buffer.from("Result(1);").toString("base64"));
  const pages = createPagesHandler([], homes, undefined, undefined, stateTree(root).directory("page-state"));
  expect(await (await pages(new Request("http://host/pages/requested--hello/"))).text()).toContain("<title>requested</title>");
});

// Mutant: remember() overwrites the first retained record when the entry hash is unchanged.
test.each(["Run.csx", "Helper.cs"])("HTTP pins retain the first script record after editing %s while latest stays fresh", async member => {
  const { root, pods, directory } = await fixture();
  const content = createContributionContent({ worldRoot: stateTree(root).directory("agent"), homeRoot: root,
    decisionsMachine: stateTree(join(root, "machine")), packages: options => listPackages({ ...options, podsRoots: pods }) });
  try {
    const app = createPeRoutes({ registrations: [], store: { getState: async () => null, setState: async () => {} },
      heads: { observe: () => () => {} }, contributionRead: async (key, hash) => { await content.read(); return content.member(key, hash); } });
    const read = async (hash?: string) => {
      const url = new URL("http://host/pe/contributions");
      url.searchParams.set("key", "script:@requested/Run.csx");
      if (hash) url.searchParams.set("sha256", hash);
      const response = await app.fetch(new Request(url));
      expect(response.status).toBe(200);
      return response.json();
    };
    const before = await read();
    const rows = async () => buildCapabilities({ ops: [], routes: [], ...(await content.read()) });
    expect((await rows()).find(row => row.key === "script:@requested/Run.csx")?.package?.sha256).toBe(before.sha256);
    const updated = member === "Run.csx" ? "Result(2);" : "class Helper { const int V=2; }";
    await fs.writeFile(join(directory, member), updated);
    expect(await read(before.sha256)).toEqual(before);
    const latest = await read();
    expect(latest.sha256).not.toBe(before.sha256);
    expect(latest.sourceBundle.files).toContainEqual({ path: member, bytesBase64: Buffer.from(updated).toString("base64") });
    await content.lifecycle.refresh();
    expect((await rows()).find(row => row.key === "script:@requested/Run.csx")?.package?.sha256).toBe(latest.sha256);
    const entryBytes = member === "Run.csx" ? updated : "Result(1);";
    expect(await content.member("member:@requested/Run.csx"))
      .toMatchObject({ sha256: createHash("sha256").update(entryBytes).digest("hex"), content: entryBytes });
  } finally { await content.close(); }
});
