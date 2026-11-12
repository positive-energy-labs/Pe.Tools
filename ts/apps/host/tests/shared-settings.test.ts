import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostHog } from "posthog-node";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { analyticsConfig } from "@pe/runtime";
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
    journal: journalAt(join(dir, "journal.json"), Date.now), root: dir, client,
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
