import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Effect, FileSystem, Schema } from "effect";
import { bridgeDocumentSnapshotSchema } from "@pe/host-contracts/contracts";
import { NodeServices } from "@effect/platform-node";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { targetHomes } from "../src/call-route.ts";
import { bindPackageLifecycle, createPackageLifecycle } from "../src/package-lifecycle.ts";
import { listPods, readMember, writeMember, writeRun, runsDirectory } from "../src/settings.ts";
import { hostState } from "../src/host-ownership.ts";

test("a custom Pods root leaves pod and podless output in machine state, like C# PodRuns", () => {
  expect(runsDirectory("site", { podsRoot: "X:/custom/Pods" }).path).toBe(join(hostState().runs, "site"));
  expect(runsDirectory(null, { podsRoot: "X:/custom/Pods" }).path).toBe(hostState().podlessRuns);
});

// Homes slice 6, the project pointer (MAP freeze shape 4): a call that targets a document reads
// that document's project home between the user and firm homes. The temp folder stands for the
// shared drive: the firm home sits two folders under it, and the pointer is relative to it.
let user: string;
let drive: string;
let project: string;
const pointer = "Projects/2026-014 Chadds Ford";
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
const home = (root: string, tier: string) => {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "pe-home.json"), JSON.stringify({ tier }));
  return root;
};
const pod = (root: string, id: string) => {
  mkdirSync(join(root, "Pods", id), { recursive: true });
  writeFileSync(
    join(root, "Pods", id, "pod.json"),
    JSON.stringify({ schemaVersion: 2, id, name: id, version: "0.1.0", entrypoints: [] }),
  );
};
beforeEach(() => {
  user = mkdtempSync(join(tmpdir(), "pe-user-"));
  drive = mkdtempSync(join(tmpdir(), "pe-drive-"));
  project = home(join(drive, ...pointer.split("/"), "Pe.Tools"), "project");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", user);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", home(join(drive, "04 PE Software Files", "Pe.Tools"), "firm"));
  pod(user, "mine");
  pod(project, "site");
});
afterEach(() => {
  bindPackageLifecycle(undefined);
  vi.unstubAllEnvs();
  rmSync(user, { recursive: true, force: true });
  rmSync(drive, { recursive: true, force: true });
});

// Mutants, each run red once (2026-11-11): `productPodsRoots` ignores its pointer; and
// `requirePackageEnabled` asks the start census about a project home's pod.
test("a call that targets a document lists and writes its project home's Pods; a document-free listing says why it has none", async () => {
  // A serving lifecycle whose start census had no document, as the product's has.
  const lifecycle = createPackageLifecycle();
  bindPackageLifecycle(lifecycle);
  try {
    await lifecycle.ready;
    const free = await run(listPods());
    // The sentinel: the listing is not empty, so "no site" is not "nothing listed".
    expect(free.pods.map((one) => one.id)).toEqual(["mine"]);
    expect(free.projectPods).toMatch(/^No document is targeted.*appear when the call targets a document\.$/);

    const targeted = await run(listPods({ pointer }));
    expect(targeted.pods.map((one) => [one.id, one.home])).toEqual([
      ["mine", { tier: "user", path: user }],
      ["site", { tier: "project", path: project }],
    ]);
    expect(targeted.projectPods).toMatch(/serve no Pages, skills or entrypoints and do not run/);

    // The write door lands in the project home, and makes no user twin.
    const member = { pod: "site", path: "settings/a.json" };
    await run(writeMember({ ...member, content: "{}" }, { pointer }));
    expect(readFileSync(join(project, "Pods", "site", "settings", "a.json"), "utf8")).toBe("{}");
    expect(existsSync(join(user, "Pods", "site"))).toBe(false);
    expect((await run(readMember(member, { pointer }))).home).toEqual({ tier: "project", path: project });
    await expect(run(readMember(member))).rejects.toMatchObject({ statusCode: 403 });

    expect((await run(listPods({ pointer: null }))).projectPods).toMatch(/names no project home/);
    expect((await run(listPods({ pointer: "Projects/Gone" }))).projectPods).toMatch(
      /'Projects\/Gone', which was not found/,
    );
  } finally {
    await lifecycle.close();
  }
});

// Mutant, run red once (2026-11-11): `targetHomes` returns no pointer for every scope.
test("the pointer a call reads is its target document's, from the bridge's open-document snapshot", async () => {
  const document = (openId: string, projectHome: string | null) => ({ openId, projectHome });
  const bridge = {
    list: Effect.succeed([
      { state: { openDocuments: [document("one", pointer)] } },
      { state: { openDocuments: [document("two", null)] } },
      { state: null },
    ]),
  } as never;
  const of = (openDocumentId?: string) => Effect.runPromise(targetHomes(bridge, { openDocumentId }));
  expect(await of("one")).toEqual({ pointer });
  expect(await of("two")).toEqual({ pointer: null });
  const decode = Schema.decodeUnknownSync(bridgeDocumentSnapshotSchema);
  const snapshot = { openId: "three", title: "Model", address: null, isFamilyDocument: false, isActive: false };
  expect(() => decode(snapshot)).toThrow();
  expect(decode({ ...snapshot, projectHome: null }).projectHome).toBeNull();
  // No target, or a document that is not open: no project home, and the listing says so.
  expect(await of()).toEqual({});
  expect(await of("gone")).toEqual({});
});

// M2: filing runs under the Pod's content home violates ADR 0037 rule 6.
test("a project-only Pod files run bytes outside every content home", async () => {
  const folder = await run(writeRun("site", "project-run", { "receipt.json": "project run" }, { pointer }));
  expect(folder).toBe(join(runsDirectory("site").path, "project-run"));
  for (const home of [user, project, process.env.PE_TOOLS_SHARED_ROOT!]) {
    const rel = relative(home, folder);
    expect(isAbsolute(rel) || rel.startsWith(".."), `${folder} must be outside ${home}`).toBe(true);
  }
  expect(readFileSync(join(folder, "receipt.json"), "utf8")).toBe("project run");
  rmSync(folder, { recursive: true, force: true });
});
