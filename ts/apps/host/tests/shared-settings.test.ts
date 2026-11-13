import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtempSync } from "../../../tests/isolated-home/storage.ts";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostHog } from "posthog-node";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { analyticsConfig } from "@pe/runtime";
import { firmSettingsDir, machineFacts } from "@pe/host-contracts/product-paths";
import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { Effect } from "effect";
import { ductsFirmSchema } from "@pe/agent-contracts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { DuctFiles, firmRootPath } from "../src/ducts-files.ts";
import { resolveFirm } from "../src/reads/door.ts";
import { createReceiptExport } from "../src/receipt-export.ts";
import { journalAt } from "./effect-test.ts";

afterEach(() => vi.unstubAllEnvs());
/** A firm home a test names with the dev override: a folder proven by its marker. */
const firmHome = () => {
  const shared = mkdtempSync(join(tmpdir(), "pe-firm-"));
  writeFileSync(join(shared, "pe-home.json"), `{"tier":"firm"}`);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
  return shared;
};
// The ducts firm layer as the host reads it: the owner-keyed file (the Pod firm door's), decoded.
const readFirm = async () => {
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer())));
  return resolveFirm(await Effect.runPromise(files.firm("ducts")), ductsFirmSchema, FIRM_SEED);
};

test("no firm home: the firm read refuses with a typed reason, never the seed", async () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(firmRootPath()).toBeNull();
  expect(await readFirm()).toEqual({ refused: "no-shared-root" });
});

test("a firm file is read from <firm home>/Settings/ducts.json, and Firm/ is not read", async () => {
  const shared = firmHome();
  mkdirSync(join(shared, "Firm"));
  writeFileSync(join(shared, "Firm", "ducts.json"), JSON.stringify({ ...FIRM_SEED, version: "old-folder" }));
  expect(await readFirm()).toMatchObject({ present: false, path: join(shared, "Settings", "ducts.json") });
  mkdirSync(join(shared, "Settings"));
  writeFileSync(join(shared, "Settings", "ducts.json"), JSON.stringify({ ...FIRM_SEED, version: "firm-7" }));
  const reading = await readFirm();
  expect(reading).toMatchObject({ present: true, path: join(shared, "Settings", "ducts.json") });
  expect("firm" in reading && reading.firm.version).toBe("firm-7");
});

test("firm files are per owner: two owners, two files, each reader gets its own (S7-F3)", async () => {
  const shared = firmHome();
  mkdirSync(join(shared, "Settings"));
  for (const owner of ["ducts", "hydronic"]) writeFileSync(join(shared, "Settings", `${owner}.json`), JSON.stringify({ owner }));
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer())));
  for (const owner of ["ducts", "hydronic"])
    expect(await Effect.runPromise(files.firm(owner))).toEqual({ path: join(shared, "Settings", `${owner}.json`), json: { owner } });
});

test("a firm PostHog key exports receipts yet never lands in a receipt file or a log line", async () => {
  const shared = firmHome();
  writeFileSync(join(shared, "keys.json"), JSON.stringify({ "posthog.api-key": "phc_SHARED_LEAK_PROBE" }));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", mkdtempSync(join(tmpdir(), "pe-user-")));
  const config = analyticsConfig("dev");
  expect(config?.apiKey).toBe("phc_SHARED_LEAK_PROBE");
  const logs: unknown[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args) => void logs.push(...args)),
  );
  const dir = mkdtempSync(join(tmpdir(), "pe-receipts-"));
  let sent = 0;
  const client = new PostHog(config!.apiKey, {
    disableCompression: true, disableGeoip: true, flushInterval: 0, fetchRetryCount: 0,
    enableExceptionAutocapture: false,
    fetch: async () => (sent++, new Response("{}", { status: 200 })),
  });
  const stamp = receiptGoldenEnvelope.stamp!;
  const exporter = createReceiptExport({
    journal: journalAt(join(dir, "journal.json"), Date.now), root: stateFixture(dir), client,
    stamps: { host: { ...stamp, component: "host" }, web: null },
  });
  try {
    await exporter.record(
      { kind: "diagnostic", code: "pane.failed", localRef: { path: "C:/x" } },
      receiptGoldenEnvelope.join, exporter.stamps.host, { id: randomUUID(), at: receiptGoldenEnvelope.at },
    );
    await expect.poll(() => sent).toBe(1);
  } finally {
    await exporter.close();
    spies.forEach((spy) => spy.mockRestore());
  }
  const written = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
  expect(written.length).toBeGreaterThan(0);
  expect(written.join(" ") + JSON.stringify(logs.map(String))).not.toContain("phc_SHARED_LEAK_PROBE");
});

test("the dev PostHog key is the firm's alone: the user home's preferences.json is not read", () => {
  const shared = firmHome();
  writeFileSync(join(shared, "keys.json"), JSON.stringify({ "posthog.api-key": "phc_shared" }));
  const user = mkdtempSync(join(tmpdir(), "pe-user-"));
  writeFileSync(join(user, "preferences.json"), JSON.stringify({ posthog: { apiKey: "phc_user" } }));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", user);
  expect(analyticsConfig("dev")?.apiKey).toBe("phc_shared");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(analyticsConfig("dev")).toBeNull();
});

// Mutant H5-pinned-home: keep the construction-time firm root and ignore its marker.
test("a marker-only loss invalidates the firm leaf and restoring it reacquires the unchanged file", async () => {
  const shared = firmHome();
  mkdirSync(join(shared, "Settings"));
  const path = join(shared, "Settings", "ducts.json");
  const bytes = JSON.stringify({ version: "marker-test", criteria: { terminalDropInWg: 0.05 } });
  writeFileSync(path, bytes);
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer())));
  const changes: string[] = [];
  const stop = files.subscribe!(name => changes.push(name));
  try {
    expect(await Effect.runPromise(files.firm("ducts"))).toMatchObject({ path, json: { version: "marker-test" } });
    renameSync(join(shared, "pe-home.json"), join(shared, "marker-away.json"));
    await expect.poll(() => changes.length).toBe(1);
    expect(await Effect.runPromise(files.firm("ducts"))).toEqual({ refused: "no-shared-root" });
    renameSync(join(shared, "marker-away.json"), join(shared, "pe-home.json"));
    await expect.poll(() => changes.length).toBe(2);
    expect(await Effect.runPromise(files.firm("ducts"))).toMatchObject({ path, json: { version: "marker-test" } });
    expect(readFileSync(path, "utf8")).toBe(bytes);
  } finally {
    stop();
    rmSync(shared, { recursive: true, force: true });
  }
});

// K2: files alone stay [] across marker loss; the watcher key must include the root.
test.each(["override", "probe"] as const)("marker loss with no Settings file fires exactly one change (%s)", async (source) => {
  const drive = mkdtempSync(join(tmpdir(), "pe-firm-drive-"));
  const shared = source === "override" ? drive : join(drive, "04 PE Software Files", "Pe.Tools");
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, "pe-home.json"), '{"tier":"firm"}');
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", source === "override" ? shared : "");
  const facts = machineFacts([drive]);
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer({
    firm: source === "override" ? firmRootPath : () => firmSettingsDir(facts),
    catalogs: [],
  }))));
  const changes: string[] = [];
  const stop = files.subscribe!(name => changes.push(name));
  try {
    expect(await Effect.runPromise(files.firm("ducts"))).toEqual({ path: join(shared, "Settings", "ducts.json") });
    renameSync(join(shared, "pe-home.json"), join(shared, "marker-away.json"));
    await expect.poll(() => changes).toEqual(["firm"]);
    expect(await Effect.runPromise(files.firm("ducts"))).toEqual({ refused: "no-shared-root" });
    // A later filesystem hint drains after the first change and must stay quiet.
    writeFileSync(join(shared, "unrelated.txt"), "hint");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(changes).toEqual(["firm"]);
  } finally {
    stop();
    rmSync(drive, { recursive: true, force: true });
  }
});

// Mutant W3-firm: drop the missing-home probe; the mounted drive never invalidates the input.
test("a firm drive mounted after subscription is discovered and then watched", async () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  const drive = mkdtempSync(join(tmpdir(), "pe-late-firm-"));
  const shared = join(drive, "04 PE Software Files", "Pe.Tools");
  const facts = machineFacts([drive]);
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer({
    firm: () => firmSettingsDir(facts), catalogs: [],
  }))));
  const changes: string[] = [];
  const stop = files.subscribe!(name => changes.push(name));
  try {
    expect(await Effect.runPromise(files.firm("ducts"))).toEqual({ refused: "no-shared-root" });
    mkdirSync(join(shared, "Settings"), { recursive: true });
    writeFileSync(join(shared, "pe-home.json"), '{"tier":"firm"}');
    const path = join(shared, "Settings", "ducts.json");
    writeFileSync(path, JSON.stringify({ version: "firm" }));
    await vi.advanceTimersByTimeAsync(30_001);
    await expect.poll(() => changes).toEqual(["firm"]);
    expect(await Effect.runPromise(files.firm("ducts"))).toEqual({ path, json: { version: "firm" } });
    writeFileSync(path, JSON.stringify({ version: "updated" }));
    await expect.poll(() => changes).toEqual(["firm", "firm"]);
    expect(await Effect.runPromise(files.firm("ducts"))).toMatchObject({ json: { version: "updated" } });
  } finally {
    stop();
    vi.useRealTimers();
    rmSync(drive, { recursive: true, force: true });
  }
});

test("W3e outside rewrite of the user tier fires exactly one change", async () => {
  const { watchSettingTiers } = await import("../src/tiered-settings.ts");
  const home = mkdtempSync(join(tmpdir(), "pe-user-watch-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  mkdirSync(join(home, "Settings"));
  const path = join(home, "Settings", "ducts.json");
  writeFileSync(path, '{"version":"before"}');
  let changes = 0;
  const watches = watchSettingTiers(() => changes++);
  try {
    expect(watches.read("ducts").find(tier => tier.tier === "user")).toMatchObject({ path, json: { version: "before" } });
    writeFileSync(path, '{"version":"after"}');
    await expect.poll(() => changes).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(changes).toBe(1);
  } finally { watches.close(); rmSync(home, { recursive: true, force: true }); }
});

test("a failed firm refresh keeps its value and the next refresh still notifies", async () => {
  const shared = firmHome();
  let fail = 0;
  let attempts = 0;
  const root = () => {
    attempts++;
    if (fail > 0 && --fail === 0) throw Error("one read failed");
    return join(shared, "Settings");
  };
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer({ firm: root, catalogs: [] }))));
  const changes: string[] = [];
  const stop = files.subscribe!(name => changes.push(name));
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const before = attempts;
    fail = 2;
    writeFileSync(join(shared, "pe-home.json"), '{"tier":"firm","name":"changed"}');
    await expect.poll(() => attempts).toBeGreaterThan(before);
    mkdirSync(join(shared, "Settings"));
    writeFileSync(join(shared, "Settings", "ducts.json"), '{"version":"later"}');
    await expect.poll(() => changes).toEqual(["firm"]);
  } finally { stop(); rmSync(shared, { recursive: true, force: true }); }
});
