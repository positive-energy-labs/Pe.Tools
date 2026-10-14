import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, test } from "vite-plus/test";
import { capturePackage, readPackage } from "../src/packages.ts";
import { exportPage } from "../src/page-export.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { exportPod, importPod } from "../src/pod-transfer.ts";

const examples = join(import.meta.dirname, "../../../../examples/pods");
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function authored(root: string, directory = root): Promise<[string, string][]> {
  const files: [string, string][] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await authored(root, path)));
    else files.push([relative(root, path).replaceAll("\\", "/"), sha(await readFile(path))]);
  }
  return files.sort(([a], [b]) => a.localeCompare(b));
}

// f45fdc44 authored bytes, except the owner-approved explicit export flag in circuits (2026-10-14).
// Runtime state and exported artifacts are created only in temp copies.
test.each([
  ["snowdon-ducts", "0860ce4e13340f99810f71229a38450bf9d7bb8828216fd434f25f531fa9a70e"],
  ["snowdon-circuits", "8241821453b85218a1e0108efd1067d06a3fc7ec2705e55acd7e05150e0a69ce"],
])(
  "%s survives production transfer, hosted serving and standalone export unchanged",
  async (id, hash) => {
    const source = join(examples, id);
    const before = await authored(source);
    expect(
      sha(JSON.stringify(before)),
      "authored example bytes differ from the reviewed source pin",
    ).toBe(hash);
    const root = await mkdtemp(join(tmpdir(), "pe-snowdon-acceptance-"));
    try {
      const from = join(root, "from"),
        to = join(root, "to");
      await cp(source, join(from, "Renamed"), { recursive: true });
      const archivePath = join(root, `${id}.zip`);
      const exported = await exportPod({ pod: id, archivePath }, { podsRoot: from });
      expect(exported.transforms).toEqual([]);
      expect(
        exported.members.map((m) => [m.path, m.sha256]).sort(([a], [b]) => a!.localeCompare(b!)),
      ).toEqual(before);
      await importPod({ archivePath, folder: "Elsewhere" }, { podsRoot: to });
      const pod = await readPackage(id, to);
      expect(pod.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(
        (await capturePackage(pod)).members
          .map((m) => [m.path, sha(m.bytes)])
          .sort(([a], [b]) => a!.localeCompare(b!)),
      ).toEqual(before);
      const handle = createPagesHandler(join(root, "pages"), to);
      const slug = `${id}--tour`;
      const page = await handle(new Request(`http://host/pages/${slug}/`));
      expect(page.status).toBe(200);
      const hosted = await page.text();
      expect(hosted).toContain(`page:@${id}/pages/tour`);
      const sourceHtml = await readFile(join(source, "pages/tour/index.html"), "utf8");
      expect(hosted).toContain(/<title>(.*?)<\/title>/.exec(sourceHtml)![0]);
      const library = async (path: string) => {
        const response = await handle(new Request(`http://host${path}`));
        expect(response.status, path).toBe(200);
        return response.text();
      };
      const servedPe = await library("/pages/pe.js");
      expect(servedPe).not.toContain("/*pe:client*/ null");
      expect(servedPe).not.toContain("/*pe:runtime*/ null");
      const snapshot = null;
      const standalone = await exportPage({
        directory: join(to, "Elsewhere/pages/tour"),
        page: `page:@${id}/pages/tour`,
        exportedAt: "2026-10-13T00:00:00.000Z",
        document: null,
        snapshot,
        events: [],
        library,
      });
      expect(await readFile(standalone.path, "utf8")).toBe(standalone.html);
      expect(sha(standalone.html)).toBe(standalone.sha256);
      expect(standalone.html).toContain("connect-src 'none'");
      expect(standalone.html).not.toMatch(/<script[^>]+src=/i);
      expect(standalone.provenance.snapshot).toEqual(snapshot);
      for (const file of standalone.provenance.files.filter((f) => !f.path.startsWith("/")))
        expect(file.sha256, file.path).toBe(
          sha(await readFile(join(source, "pages/tour", file.path))),
        );
      expect(await authored(source)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20_000,
);
