import { hostState } from "../src/host-ownership.ts";
import { ledgerFixture } from "./storage.ts";
import { mkdtempSync } from "../../../tests/isolated-home/storage.ts";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Effect, FileSystem } from "effect";
import { NodeServices } from "@effect/platform-node";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync,
  readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { firmHome, homes, userRoot } from "@pe/host-contracts/product-paths";
import { stateTree } from "@pe/host-contracts/service-identity";
import * as paths from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { capturePackage, listPackages, readPackage } from "../src/packages.ts";
import { productPagesRoots, scratchPageDescriptors, scratchPageDirectory } from "../src/page-libraries.ts";
import { commitPagePublication, pageVersion } from "../src/page-publication.ts";
import { importShippedPods } from "../src/installed-pods.ts";
import { readDuctCatalogs } from "../src/duct-catalogs.ts";
import { listPods, listRuns, readMember, saveMember, writeMember, writeRun } from "../src/settings.ts";
import { sourceRunDirectory } from "../src/family-actions.ts";
import { writeZip } from "../src/pod-transfer.ts";
import { importPod } from "./pod-import.ts";
import { peaMcpServer } from "../src/harness/adapter.ts";

// ADR 0037: the user home always, the firm home after it, each proven by its marker. A test names
// its firm home with the dev override; the probe that finds one with no variable is H1, in
// host-contracts `product-paths.test.ts`.
let user: string;
let firm: string;
beforeEach(() => {
  user = mkdtempSync(join(tmpdir(), "pe-user-"));
  firm = mkdtempSync(join(tmpdir(), "pe-firm-"));
  writeFileSync(join(firm, "pe-home.json"), `{"tier":"firm"}`);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", user);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(user, { recursive: true, force: true });
  rmSync(firm, { recursive: true, force: true });
  rmSync(stateTree(hostOwnership.rootPath).runs, { recursive: true, force: true });
});
const under = (root: string, path: string) => {
  const away = relative(root, path);
  return !isAbsolute(away) && away !== ".." && !away.startsWith("../") && !away.startsWith("..\\");
};
/** Every file under a root with its bytes. */
const tree = (root: string) =>
  existsSync(root)
    ? Object.fromEntries(
        readdirSync(root, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const path = join(entry.parentPath, entry.name);
            return [relative(root, path), readFileSync(path, "base64")];
          }),
      )
    : {};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
const pod = (home: string, folder: string, id: string, name: string) => {
  mkdirSync(join(home, "Pods", folder, "settings"), { recursive: true });
  writeFileSync(
    join(home, "Pods", folder, "pod.json"),
    JSON.stringify({ schemaVersion: 2, id, name, version: "0.1.0", entrypoints: [] }),
  );
  return join(home, "Pods", folder);
};
const page = (home: string, slug: string, title: string) => {
  mkdirSync(join(home, "Pages", slug), { recursive: true });
  writeFileSync(join(home, "Pages", slug, "index.html"), `<title>${title}</title>`);
  return join(home, "Pages", slug);
};
const catalog = (home: string, folder: string, id: string, title: string) => {
  mkdirSync(join(home, "Catalogs", folder), { recursive: true });
  writeFileSync(join(home, "Catalogs", folder, "source.pdf"), "%PDF-");
  const axis = { quantity: "q", unit: "u", values: [1, 2], input: { field: "flowCfm" } };
  const table = {
    id,
    title,
    source: { file: "source.pdf", title: "t", edition: "1", url: "https://x.test", page: 1, pdfPage: 1 },
    rows: axis,
    columns: axis,
    cells: { quantity: "q", unit: "u", values: [[1, 2], [3, 4]] },
    result: { from: "cells", quantity: "coefficient", unit: "1", toInWg: 1, velocityBasis: "connector", note: "n" },
  };
  writeFileSync(
    join(home, "Catalogs", folder, "catalog.json"),
    JSON.stringify({ version: 1, tables: [table] }),
  );
};

test("unbound: with no firm home the host's resolvers all answer, on the user home alone", () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(firmHome().root).toBeNull();
  expect(homes()).toEqual([{ tier: "user", root: user }]);
  for (const [name, resolver] of Object.entries(paths)) expect(resolver, name).not.toThrow();
  expect(paths.productPodsRootPath()).toBe(join(user, "Pods"));
});

test("a told firm folder with no firm marker is no firm home: its pods are not read", async () => {
  rmSync(join(firm, "pe-home.json"));
  pod(firm, "theirs", "theirs", "unproven");
  expect(homes()).toEqual([{ tier: "user", root: user }]);
  expect((await listPackages()).packages).toEqual([]);
});

test("every content path sits in the user home; Work and every machine path stay with their owner", () => {
  const content = new Set([
    "productUserContentRootPath",
    "productPodsRootPath",
    "productPagesRootPath",
  ]);
  for (const [name, resolver] of Object.entries(paths)) {
    const path = resolver();
    expect(under(firm, path), `${name}: ${path}`).toBe(false);
    expect(under(content.has(name) ? user : hostOwnership.rootPath, path), name).toBe(true);
  }
  expect(hostState().work).toBe(join(hostOwnership.rootPath, "state", "Work"));
});

// H2 (homes MAP slice 6). Mutant: restore the first-by-id filter in `listPackages`
// (`listing.packages.filter((pod) => !claimed.has(pod.id))`) and this goes red: the user's copy
// would list alone and resolve.
test("H2: one pod id in the user and firm homes refuses both, with one notice naming both paths", async () => {
  const mine = pod(user, "mine", "duct-tools", "user copy");
  const theirs = pod(firm, "firm", "duct-tools", "firm copy");
  pod(firm, "extras", "extras", "firm only");
  const listing = await listPackages();
  // No silent shadow: both copies list, both refused, and the firm-only pod is untouched.
  expect(listing.packages.map((p) => [p.id, p.name])).toEqual([
    ["duct-tools", "user copy"],
    ["extras", "firm only"],
    ["duct-tools", "firm copy"],
  ]);
  const notices = listing.packages
    .filter((p) => p.id === "duct-tools")
    .map((p) => p.diagnostics.filter((d) => d.code === "DuplicatePodId").map((d) => d.message));
  expect(notices[0]).toHaveLength(1);
  expect(notices[1]).toEqual(notices[0]);
  expect(notices[0]![0]).toContain(mine);
  expect(notices[0]![0]).toContain(theirs);
  for (const twin of listing.packages.filter((p) => p.id === "duct-tools")) {
    expect(twin.contributions).toEqual([]);
    await expect(capturePackage(twin)).rejects.toThrow(/is claimed by/);
  }
  await expect(readPackage("duct-tools")).rejects.toThrow(notices[0]![0]!);
  // Every door refuses the id: a read, a save and a create all name the conflict; nothing is written.
  const before = [tree(user), tree(firm)];
  const member = { pod: "duct-tools", path: "settings/a.json" };
  await expect(run(readMember(member))).rejects.toMatchObject({ statusCode: 409 });
  await expect(run(writeMember({ ...member, content: "{}" }))).rejects.toThrow(/is claimed by/);
  expect([tree(user), tree(firm)]).toEqual(before);
  expect((await readPackage("extras")).directory).toBe(join(firm, "Pods", "extras"));
});

// H2. Mutant: make `writablePath` return the user-home twin of the path again
// (`join(userRoot(), relative(firmHome().root!, path))`) and this goes red twice: the firm bytes
// stay unchanged and a user copy appears.
test("H2: a write to a pod that lives only in the firm home changes the firm home's bytes and makes no user copy", async () => {
  const theirs = pod(firm, "theirs", "theirs", "firm");
  writeFileSync(join(theirs, "settings", "a.json"), "{}");
  const member = { pod: "theirs", path: "settings/a.json" };
  const { sha256 } = await run(readMember(member));
  await run(saveMember({ ...member, content: '{"b":1}', expectedSha256: sha256 }));
  await run(writeMember({ pod: "theirs", path: "settings/new.json", content: "[]" }));
  expect(readFileSync(join(theirs, "settings", "a.json"), "utf8")).toBe('{"b":1}');
  expect(readFileSync(join(theirs, "settings", "new.json"), "utf8")).toBe("[]");
  expect((await run(readMember(member))).content).toBe('{"b":1}');
  expect((await readPackage("theirs")).directory).toBe(theirs);
  // No user copy: the user home holds nothing at all.
  expect(tree(user)).toEqual({});
  expect(existsSync(join(user, "Pods"))).toBe(false);
});

// H4 (homes MAP slice 6). Mutants: pass `sha256(current bytes)` instead of
// `request.expectedSha256` to the door in `saveMember` and the stale save is no longer refused;
// drop the blob write in `writeHomeFile` and the prior bytes are gone.
test("H4: an overwrite in the firm home leaves the prior bytes in Blobs under the receipt's hash; a stale hash is refused", async () => {
  const theirs = pod(firm, "theirs", "theirs", "firm");
  const prior = '{"prior":true}';
  writeFileSync(join(theirs, "settings", "a.json"), prior);
  const member = { pod: "theirs", path: "settings/a.json" };
  const blobs = stateTree(hostOwnership.rootPath).blobs;
  expect(under(firm, blobs) || under(user, blobs)).toBe(false);
  const written = await run(saveMember({ ...member, content: '{"next":1}', expectedSha256: sha(prior) }));
  expect(written).toEqual({ ...member, sha256: sha('{"next":1}') });
  // The receipt's prior hash is the one the caller sent, and the blob store holds those bytes.
  expect(readFileSync(join(blobs, "sha256", sha(prior)), "utf8")).toBe(prior);
  // A second writer still holding the first hash is stale: refused, nothing written, no new blob.
  const held = readdirSync(join(blobs, "sha256")).length;
  await expect(
    run(saveMember({ ...member, content: '{"late":1}', expectedSha256: sha(prior) })),
  ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("changed since it was read") });
  expect(readFileSync(join(theirs, "settings", "a.json"), "utf8")).toBe('{"next":1}');
  expect(readdirSync(join(blobs, "sha256"))).toHaveLength(held);
  // A create over an existing member is refused the same way.
  await expect(run(writeMember({ ...member, content: "{}" }))).rejects.toMatchObject({ statusCode: 409 });
  expect(readFileSync(join(theirs, "settings", "a.json"), "utf8")).toBe('{"next":1}');
});

test("a Page slug in two homes refuses both; a slug in one home resolves there", async () => {
  const mine = page(user, "tour", "user tour");
  const theirs = page(firm, "tour", "firm tour");
  page(firm, "intro", "firm intro");
  const pages = await scratchPageDescriptors();
  expect(pages.map((p) => [p.slug, p.title, p.key]).sort()).toEqual([
    ["intro", "firm intro", "page:@pages/intro"],
    ["tour", "firm tour", null],
    ["tour", "user tour", null],
  ]);
  const reason = pages.find((p) => p.slug === "tour")!.reason!;
  expect(reason).toContain(mine);
  expect(reason).toContain(theirs);
  expect(await scratchPageDirectory("tour")).toBeNull();
  expect((await scratchPageDirectory("intro"))?.dir).toBe(join(firm, "Pages", "intro"));
  // A new Page starts in the user home.
  expect((await scratchPageDirectory("fresh"))?.dir).toBe(join(user, "Pages", "fresh"));
});

test("a catalog table id in two homes admits no table, with a finding", async () => {
  catalog(user, "smacna", "round", "user round");
  catalog(firm, "smacna", "square", "same folder name, another id");
  catalog(firm, "firm", "round", "firm round");
  catalog(firm, "oval", "oval", "firm oval");
  const reading = await readDuctCatalogs();
  expect(reading.findings).toEqual(["Duplicate catalog table round; no table with this id is admitted"]);
  expect(Object.values(reading.tables).map((t) => [t.id, t.title]).sort()).toEqual([
    ["oval", "firm oval"],
    ["square", "same folder name, another id"],
  ]);
});

test("run output is machine state: declaring and filing a run of a firm-only pod writes into no home", async () => {
  pod(firm, "theirs", "theirs", "firm");
  const before = [tree(user), tree(firm)];
  const runs = join(stateTree(hostOwnership.rootPath).runs, "theirs");
  // Every Pod-run command's bind declares this effect before consent (ADR 0027): pure, no write.
  expect((await sourceRunDirectory("theirs", {})).path).toBe(runs);
  expect((await sourceRunDirectory(null, {})).path).toBe(stateTree(hostOwnership.rootPath).podlessRuns);
  expect(existsSync(runs)).toBe(false);
  expect(await run(writeRun("theirs", "run-1", { "receipt.json": "{}" }))).toBe(join(runs, "run-1"));
  expect(readFileSync(join(runs, "run-1", "receipt.json"), "utf8")).toBe("{}");
  expect((await run(listRuns({ pod: "theirs" }))).runs.map((r) => [r.runId, r.receiptPath])).toEqual([
    ["run-1", join(runs, "run-1", "receipt.json")],
  ]);
  expect([tree(user), tree(firm)]).toEqual(before);
  await expect(sourceRunDirectory("absent", {})).rejects.toThrow(/No installed pod/);
});

test("importing a pod whose id the firm home already holds is refused: no duplicate is minted", async () => {
  const theirs = pod(firm, "theirs", "theirs", "firm");
  const archive = join(user, "theirs.zip");
  writeFileSync(
    archive,
    writeZip(new Map([["pod.json", Buffer.from(JSON.stringify({ schemaVersion: 2, id: "theirs", entrypoints: [] }))]])),
  );
  await expect(importPod({ archivePath: archive })).rejects.toThrow(`already installed at '${theirs}'`);
  expect(existsSync(join(user, "Pods"))).toBe(false);
});

// Mutant, run red once (2026-11-12): `podHome` returns the first home for every folder.
test("H2: a read says which home a pod is in, and a member read says when its file was last written", async () => {
  pod(user, "mine", "mine", "user");
  const theirs = pod(firm, "theirs", "theirs", "firm");
  writeFileSync(join(theirs, "settings", "a.json"), "{}");
  const listed = (await run(listPods())).pods.map((one) => [one.id, one.home]);
  expect(listed).toEqual([
    ["mine", { tier: "user", path: user }],
    ["theirs", { tier: "firm", path: firm }],
  ]);
  const read = await run(readMember({ pod: "theirs", path: "settings/a.json" }));
  expect(read.home).toEqual({ tier: "firm", path: firm });
  expect(read.modifiedAt).toBe(statSync(join(theirs, "settings", "a.json")).mtime.toISOString());
});

const archiveOf = (path: string, id: string) => {
  writeFileSync(
    path,
    writeZip(new Map([["pod.json", Buffer.from(JSON.stringify({ schemaVersion: 2, id, entrypoints: [] }))]])),
  );
  return path;
};

// Mutant, run red once (2026-11-12): in `installed-pods.ts` `run`, check `productPodsRootPath()`
// (the user home alone) instead of every home.
test("W1: a shipped example whose id the firm home holds is not installed again in the user home", async () => {
  const theirs = pod(firm, "example", "example", "firm");
  const shipped = join(user, "shipped");
  mkdirSync(shipped);
  archiveOf(join(shipped, "example.zip"), "example");
  const report = await importShippedPods({ shippedRoot: shipped, ledger: ledgerFixture(join(user, "state", "shipped-pods.json")) });
  expect(report.outcomes).toMatchObject([{ outcome: "present", id: "example", reason: `installed at '${theirs}'` }]);
  expect(existsSync(join(user, "Pods", "example"))).toBe(false);
  // The sentinel: the firm pod is still the one admitted pod of that id.
  expect((await listPackages()).packages.filter((p) => p.id === "example").map((p) => p.directory)).toEqual([theirs]);
});

// Mutant, run red once (2026-11-12): in `installArchive`, check the folder in the user home only.
test("W3: importing under a folder name another home already uses is refused", async () => {
  const theirs = pod(firm, "kept", "firm-kept", "firm");
  await expect(
    importPod({ archivePath: archiveOf(join(user, "other.zip"), "other"), folder: "kept" }),
  ).rejects.toThrow(`Pod folder already exists: ${theirs}`);
  expect(existsSync(join(user, "Pods", "kept"))).toBe(false);
});

// Mutant, run red once (2026-11-12): `pageHomeRoot` returns the first (user) root for every slug.
test("W2: page.publish writes a firm Page where it is, through the door, and makes no user twin", async () => {
  const theirs = page(firm, "plan", "old");
  const before = readFileSync(join(theirs, "index.html"), "utf8");
  const input = { kind: "page" as const, slug: "plan", title: "Plan", html: "<title>new</title>" };
  const version = await pageVersion(productPagesRoots, "plan");
  // The sentinel: the version read is the firm file's, not "no such Page".
  expect(version).toBe(sha(before));
  await commitPagePublication(
    productPagesRoots,
    { input: input as never, origin: "http://fixture", capture: {} as never },
    version,
  );
  expect(readFileSync(join(theirs, "index.html"), "utf8")).toBe("<title>new</title>");
  expect(existsSync(join(user, "Pages", "plan"))).toBe(false);
  // Item 5: the door's safety net holds the bytes the publication replaced.
  expect(readFileSync(join(stateTree(hostOwnership.rootPath).blobs, "sha256", version!), "utf8")).toBe(before);
  // A slug two homes hold is refused with both paths, and nothing is written.
  page(user, "twice", "mine");
  const firms = page(firm, "twice", "theirs");
  await expect(pageVersion(productPagesRoots, "twice")).rejects.toThrow(
    `claimed by ${join(user, "Pages", "twice")} and ${firms}`,
  );
});

// Mutant, run red once (2026-11-11): `pageHomeRoot` counts a folder whether or not it holds index.html.
test("W2: an empty leftover folder is no Page, so the firm Page of that name still publishes", async () => {
  const theirs = page(firm, "left", "theirs");
  mkdirSync(join(user, "Pages", "left"), { recursive: true });
  expect(await pageVersion(productPagesRoots, "left")).toBe(
    sha(readFileSync(join(theirs, "index.html"), "utf8")),
  );
});

test("the harness tells its MCP child the firm home it resolved", () => {
  expect(peaMcpServer(null, "http://localhost:1234", "test").env).toContainEqual({
    name: "PE_TOOLS_SHARED_ROOT",
    value: firm,
  });
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(
    peaMcpServer(null, "http://localhost:1234", "test").env.map((entry) => entry.name),
  ).not.toContain("PE_TOOLS_SHARED_ROOT");
});
