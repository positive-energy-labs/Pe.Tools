import { expect, test } from "vite-plus/test";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { podArtifactSchema, verifyPodArtifact } from "../src/pod-artifact.ts";

const examples = join(import.meta.dirname, "../../../../examples/pods");

test("every example Pod Page script path resolves to a declared entrypoint", async () => {
  let checked = 0;
  for (const pod of (await readdir(examples, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    const root = join(examples, pod.name);
    const pages = join(root, "pages");
    const files = await readdir(pages, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (!files.length) continue;
    const manifest = JSON.parse(await readFile(join(root, "pod.json"), "utf8"));
    const declared = new Set(manifest.entrypoints.map((entry: { sourcePath: string }) => entry.sourcePath));
    for (const file of files.filter((file) => file.endsWith(".html"))) {
      const html = await readFile(join(pages, file), "utf8");
      for (const match of html.matchAll(/(["'`])([^\s"'`<>]+\.csx?)\1/g)) {
        const path = match[2]!;
        const member = path.startsWith(`script:@${manifest.id}/`)
          ? path.slice(`script:@${manifest.id}/`.length)
          : // pe.js scriptKey (D41): ./ and ../ resolve beside the Page; a bare path and a leading / resolve from the Pod root.
            decodeURIComponent(
              new URL(path, `http://pod/${/^\.\.?\//.test(path) ? `pages/${file.split(sep).join("/")}` : ""}`).pathname.slice(1),
            );
        expect(declared.has(member), `${pod.name}/pages/${file}: ${path} resolves to undeclared ${member}`).toBe(true);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
});

async function verifyExamples(root: string) {
  const artifacts: string[] = [];
  for (const pod of (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    const routes = join(root, pod.name, "routes");
    const children = await readdir(routes, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const route of children.filter((entry) => entry.isDirectory())) {
      if ((await readdir(join(routes, route.name))).includes("route.artifact"))
        artifacts.push(join(pod.name, "routes", route.name, "route.artifact"));
    }
  }
  artifacts.sort();
  expect(artifacts.length).toBeGreaterThan(0);
  for (const file of artifacts) {
    const pod = file.split(sep)[0]!;
    const manifest = JSON.parse(await readFile(join(root, pod, "pod.json"), "utf8")) as {
      routes: { artifact: string; fingerprint: string }[];
    };
    const artifact = relative(join(root, pod), join(root, file)).split(sep).join("/");
    const routes = manifest.routes.filter((route) => route.artifact === artifact);
    expect(routes, file).toHaveLength(1);
    await verifyPodArtifact(JSON.parse(await readFile(join(root, file), "utf8")), routes[0]!.fingerprint);
  }
}

test("every checked-in example route artifact matches its pod fingerprint", async () => {
  await verifyExamples(examples);
});

test.each(["data.name", "payload byte", "manifest fingerprint"] as const)(
  "example verification rejects a changed %s in a temporary copy",
  async (mutant) => {
    const root = await mkdtemp(join(tmpdir(), "pe-example-artifacts-"));
    try {
      // Copy only the real manifest and artifact, excluding workspace dependencies.
      const pod = "snowdon-circuits";
      await mkdir(join(root, pod), { recursive: true });
      await copyFile(join(examples, pod, "pod.json"), join(root, pod, "pod.json"));
      const manifestPath = join(root, pod, "pod.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const route = manifest.routes[0];
      const artifactPath = join(root, pod, route.artifact);
      await mkdir(dirname(artifactPath), { recursive: true });
      await copyFile(join(examples, pod, route.artifact), artifactPath);
      const wire = podArtifactSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")));
      if (mutant === "data.name") {
        const data = wire.artifact.data as { name: string };
        data.name += " changed";
      } else if (mutant === "payload byte") {
        const bytes = wire.executables[0]!.members[0]!.bytes;
        expect(bytes.length).toBeGreaterThan(0);
        bytes[0] = bytes[0]! ^ 1;
      } else {
        route.fingerprint = `pod-bytes:${"0".repeat(64)}`;
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      await writeFile(artifactPath, JSON.stringify(wire));
      await expect(verifyExamples(root)).rejects.toThrow("Pod artifact bytes or fingerprint differ");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
