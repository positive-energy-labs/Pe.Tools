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
// The ducts firm layer as the host reads it: the owner-keyed file (the Pod firm door's), decoded.
const readFirm = async () => {
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer())));
  return resolveFirm(await Effect.runPromise(files.firm("ducts")), ductsFirmSchema, FIRM_SEED);
};

test("no shared root: the firm read refuses with a typed reason, never the seed", async () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(firmRootPath()).toBeNull();
  expect(await readFirm()).toEqual({ refused: "no-shared-root" });
});

test("a shared firm file is read from <shared>/Firm/ducts.json", async () => {
  const shared = mkdtempSync(join(tmpdir(), "pe-shared-"));
  mkdirSync(join(shared, "Firm"));
  writeFileSync(join(shared, "Firm", "ducts.json"), JSON.stringify({ ...FIRM_SEED, version: "firm-7" }));
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
  const reading = await readFirm();
  expect(reading).toMatchObject({ present: true, path: join(shared, "Firm", "ducts.json") });
  expect("firm" in reading && reading.firm.version).toBe("firm-7");
});

test("a shared PostHog key exports receipts yet never lands in a receipt file or a log line", async () => {
  const shared = mkdtempSync(join(tmpdir(), "pe-shared-"));
  writeFileSync(join(shared, "keys.json"), JSON.stringify({ posthog: "phc_SHARED_LEAK_PROBE" }));
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
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

test("a dev PostHog key of the user's own overrides the shared one", () => {
  const shared = mkdtempSync(join(tmpdir(), "pe-shared-"));
  writeFileSync(join(shared, "keys.json"), JSON.stringify({ posthog: "phc_shared" }));
  const user = mkdtempSync(join(tmpdir(), "pe-user-"));
  writeFileSync(join(user, "preferences.json"), JSON.stringify({ posthog: { apiKey: "phc_user" } }));
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", user);
  expect(analyticsConfig("dev")?.apiKey).toBe("phc_user");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", mkdtempSync(join(tmpdir(), "pe-user-")));
  expect(analyticsConfig("dev")).toBeNull();
});
