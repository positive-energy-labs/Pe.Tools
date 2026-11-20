import { stateMachine, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { dirname as storedParent } from "node:path";
import { ledgerFixture } from "./storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
/**
 * Guard M1 (homes slice 5, ADR 0037 rule 6): a content home holds only authored files. Two
 * "machines" with their own state root, install root and port bootstrap one home, and the home
 * comes out byte-identical apart from the files an exclusive create adds once. Everything else a
 * machine derives (the harness projections, the Codex config, Work, Page state and exports) lands
 * under that machine's state root.
 *
 * Named mutant, run red once (2026-11-11): in `createContributionContent`, pass
 * `agentPath: homeRoot` to `publishPeaSkills`, so a projection is written back into the home.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { stateDirectory } from "@pe/host-contracts/service-identity";
import { writePeaCodexProjectConfig } from "../src/harness/user-shell.ts";
import { importShippedPods } from "../src/installed-pods.ts";
import { listPackages } from "../src/packages.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { createContributionContent } from "../src/pe-routes.ts";
import { exportPod } from "../src/pod-transfer.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { asCaller, human } from "./callers.ts";
import { pictureCaptures } from "./effect-test.ts";

/** What T3 names a delegated child: it holds `:` and `%`, and neither may reach a path. */
const T3_THREAD = "thread:delegated-task:command%3Amcp%3Afoo";
const SENTINEL = join("Skills", "office", "SKILL.md");
const SENTINEL_BYTES = "---\nname: office\ndescription: Office rules.\n---\n\nAuthored bytes.\r\n";

const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const outside = (root: string, path: string) => {
  const away = relative(root, path);
  return away === ".." || away.startsWith(`..${sep}`) || isAbsolute(away);
};
/** Every file under a root, by relative path. */
async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}
/** The scan set: every file under a root with the hash of its bytes. */
async function bytesOf(root: string): Promise<Record<string, string>> {
  const scanned: Record<string, string> = {};
  for (const path of await files(root)) scanned[path] = sha(await readFile(join(root, path)));
  return scanned;
}

type Machine = { name: string; state: string; install: string; port: number };
const agentOf = (machine: Machine) => join(machine.state, "Agent");

/** One home a person authored in, and two machines that hold nothing of each other's. */
async function world() {
  const root = await mkdtemp(join(tmpdir(), "pe-m1-"));
  cleanup.push(root);
  const home = join(root, "home");
  await mkdir(join(home, "Skills", "office"), { recursive: true });
  await writeFile(join(home, SENTINEL), SENTINEL_BYTES);
  await mkdir(join(home, "Pages", "todo"), { recursive: true });
  await writeFile(join(home, "Pages", "todo", "index.html"), "<title>Todo</title>");
  const machine = (name: string, port: number): Machine => ({
    name,
    state: join(root, name, "local", "Pe.Tools", "state"),
    install: join(root, name, "local", "Pe.Tools", "bin", "host"),
    port,
  });
  const machines = [machine("machine-a", 5180), machine("machine-b", 5181)] as const;
  // Both machines carry the same shipped build: one archive, written by the production exporter.
  const source = join(root, "examples");
  await mkdir(join(source, "example", "pages", "tour"), { recursive: true });
  await writeFile(
    join(source, "example", "pod.json"),
    JSON.stringify({
      schemaVersion: 2,
      id: "example",
      name: "Example",
      version: "1.0.0",
      entrypoints: [],
    }),
  );
  await writeFile(join(source, "example", "pages", "tour", "index.html"), "<title>Tour</title>");
  const archive = join(machines[0].install, "pods", "example.zip");
  await exportPod(
    { pod: "example", archivePath: archive },
    { podsRoot: source, captures: pictureCaptures(join(root, "export-captures")) },
  );
  await cp(archive, join(machines[1].install, "pods", "example.zip"));
  return { home, machines };
}

/** What a host start and a first session do, with every path this machine derives handed in. */
async function bootstrap(machine: Machine, home: string) {
  const pods = join(home, "Pods");
  const agent = agentOf(machine);
  // What an agent leaves in its own harness root: the deleted read-back copied it into `Skills/`.
  const stray = stateDirectory(stateFixture(agent), ".claude", "skills", "stray").path;
  await mkdir(stray, { recursive: true });
  await writeFile(join(stray, "SKILL.md"), `written by an agent on ${machine.name}`);
  // The content starts this import and never waits for it, and its close does not hold shutdown on
  // it. The fixture holds it instead, so no ledger write is in flight when the temp root is removed.
  let imported: Promise<unknown> = Promise.resolve();
  const content = createContributionContent({
    worldRoot: stateFixture(agent),
    homeRoot: home,
    packages: () => listPackages({ podsRoots: pods }),
    decisionsMachine: stateMachine(storedParent(join(machine.state, "plugins.json"))),
    bootstrap: () =>
      (imported = importShippedPods({
        shippedRoot: join(machine.install, "pods"),
        podsRoot: pods,
        ledger: ledgerFixture(join(machine.state, "shipped-pods.json")),
        captures: pictureCaptures(join(machine.state, "captures")),
      })),
  });
  await content.read();
  await content.close();
  await imported;
  await writePeaCodexProjectConfig(agent, ["mine"]);
  await fileRouteDocumentStore(stateFixture(join(machine.state, "Work"))).setState({
    targetKey: "document:one",
    route: "duct-systems",
    value: { rows: [machine.name] },
  });
  const pages = asCaller(
    human,
    createPagesHandler(
      join(home, "Pages"),
      pods,
      undefined,
      undefined,
      stateFixture(join(machine.state, "Pages")),
    ),
  );
  const send = async (method: string, path: string, body: unknown) => {
    const response = await pages(
      new Request(`http://127.0.0.1:${machine.port}${path}`, {
        method,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    expect(response.ok, `${machine.name} ${method} ${path}: ${response.status}`).toBe(true);
    return response;
  };
  for (const slug of ["todo", "example--tour"]) {
    await send("POST", `/pages/${slug}/events`, { type: "note", by: machine.name });
    // The text is stamped with the log sequence it was derived at: the event above is seq 1.
    await send("PUT", `/pages/${slug}/text`, { seq: 1, text: `# ${machine.name}` });
    await send("PUT", `/pe/pages/${slug}/binding`, { kind: "thread", thread: T3_THREAD });
    await send("POST", `/pages/${slug}/export`, {});
  }
  return { pages: send };
}

test("M1: two machines bootstrap one home and leave it byte-identical apart from exclusive creates", async () => {
  const { home, machines } = await world();
  const [a, b] = machines;
  // The machines differ in every identity a file could carry, and neither keeps state in the home.
  expect(a.state).not.toBe(b.state);
  expect(a.install).not.toBe(b.install);
  expect(a.port).not.toBe(b.port);
  for (const machine of machines)
    for (const path of [machine.state, machine.install, agentOf(machine)])
      expect(outside(home, path), `${path} is outside the home`).toBe(true);

  const seeded = await bytesOf(home);
  // The sentinel: the scan set is not empty and reads real bytes.
  expect(seeded[SENTINEL]).toBe(sha(SENTINEL_BYTES));
  await bootstrap(a, home);
  const afterA = await bytesOf(home);
  await bootstrap(b, home);
  const afterB = await bytesOf(home);
  expect(afterB[SENTINEL]).toBe(sha(SENTINEL_BYTES));

  // Nothing a person authored changed, on either machine's start.
  expect(afterA).toMatchObject(seeded);
  // The first machine added only what an exclusive create adds once: the default Pod and the shipped one.
  expect(Object.keys(afterA).filter((path) => !(path in seeded))).toEqual(
    [
      join("Pods", "default", "pod.json"),
      join("Pods", "example", "pages", "tour", "index.html"),
      join("Pods", "example", "pod.json"),
    ].sort(),
  );
  // The second machine found that home and changed no byte of it.
  expect(afterB).toEqual(afterA);

  // No home file names a machine, with no exception: a Pod's import record is machine state
  // (`state\pod-imports\<pod-id>.json`), never a file in the pod.
  for (const path of Object.keys(afterB)) {
    const text = (await readFile(join(home, path))).toString("latin1");
    for (const machine of machines)
      for (const mark of [machine.state, machine.install, machine.name, `:${machine.port}`])
        expect(text.includes(mark), `${path} names ${mark}`).toBe(false);
  }

  // The bootstraps were real: each machine holds its own projections, config, Work and Page state.
  for (const machine of machines) {
    const held = await files(machine.state);
    for (const path of [
      join("Agent", ".agents", "skills", "office", "SKILL.md"),
      join("Agent", ".claude", "skills", "office", "SKILL.md"),
      join("Agent", ".claude", "skills", "stray", "SKILL.md"),
      join("Agent", ".codex", "config.toml"),
      join("Pages", "todo", "events.jsonl"),
      join("Pages", "todo", "text.json"),
      join("Pages", "todo", "binding.json"),
      join("Pages", "example--tour", "events.jsonl"),
      join("Pages", "example--tour", "binding.json"),
    ])
      expect(held, `${machine.name} holds ${path}`).toContain(path);
    expect(held.filter((path) => path.startsWith(`Work${sep}`))).toHaveLength(1);
    expect(
      held.filter((path) => path.startsWith(join("Pages", "todo", "exports") + sep)),
    ).toHaveLength(1);
    expect(
      await readFile(join(agentOf(machine), ".agents", "skills", "office", "SKILL.md"), "utf8"),
    ).toBe(SENTINEL_BYTES);
  }
});

test("a T3-shaped thread id in a Page binding is data in the file, never a path segment", async () => {
  const { home, machines } = await world();
  const [machine] = machines;
  const { pages } = await bootstrap(machine, home);
  const target = (await (await pages("GET", "/pages/todo/target", undefined)).json()) as {
    binding: unknown;
  };
  expect(target.binding).toEqual({ kind: "thread", thread: T3_THREAD });
  const stored = JSON.parse(
    await readFile(join(machine.state, "Pages", "todo", "binding.json"), "utf8"),
  ) as { slots: { default: unknown } };
  expect(stored.slots.default).toEqual({ kind: "thread", thread: T3_THREAD });
  const paths = [...(await files(home)), ...(await files(machine.state))];
  // The sentinel: the walk saw the binding file it is about.
  expect(paths).toContain(join("Pages", "todo", "binding.json"));
  for (const path of paths)
    for (const piece of ["thread:", "delegated-task", "%3A", "command"])
      expect(path.includes(piece), `${path} carries ${piece}`).toBe(false);
});
