/**
 * Slice 6b falsifier (homes MAP row 6b, JOURNEYS FS, end-gate target 8): on every FS step that needs
 * no Revit (1 firm write, 2 project override, 6 a second writer, 7 firm home unmounted), the tier
 * label the sheet draws equals the home the host served, and a firm home that is not found never
 * yields "firm". The census of who served a value is read from the disk here, apart from the code
 * under test.
 *
 * Mutant, run red once (2026-11-12): in `firmLayer` (apps/host/src/ducts-inputs.ts) label a criterion
 * no home states as "firm" instead of "default". The first default label turns red (tiers.test.ts:87).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { fansSheetData, ductsFirmSchema, ductsDocumentSchema, fansDocumentSchema, ductParameterSlots, neutralFansWork, type DuctsCriteriaCell } from "@pe/agent-contracts";
import { readStoredNotices } from "@pe/host-contracts/store";
import { resolveCriteria, resolveInputs } from "@pe/ducts-domain/sheet/index";
import { nodeOf, snapshotOf } from "@pe/ducts-domain/test-snapshot";
import { DuctFiles } from "../../../host/src/ducts-files.ts";
import { firmLayer } from "../../../host/src/ducts-inputs.ts";
import { SETTING_WRITE_PLACE, storedBlobsPath, storedNoticesPath } from "../../../host/src/notice-feed.ts";
import { resolveFirm } from "../../../host/src/reads/door.ts";
import { readSettingTiers, writeSettingTier, watchSettingTiers } from "../../../host/src/tiered-settings.ts";
import { ductsSettings } from "@pe/agent-contracts/setting-owners";
import { sheetCells } from "../route/slots/sheet/index.ts";

import { price } from "@pe/ducts-domain/pricing";
import { snapshot } from "../ducts/test-fixture.ts";

import { fansSheet } from "../fans/sheet.ts";

const pointer = "Projects/2026-014 Chadds Ford";
let user: string, drive: string, firm: string, project: string;
const home = (root: string, tier: string) => {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "pe-home.json"), JSON.stringify({ tier }));
  return root;
};
beforeEach(() => {
  user = mkdtempSync(join(tmpdir(), "pe-user-"));
  drive = mkdtempSync(join(tmpdir(), "pe-drive-"));
  firm = home(join(drive, "04 PE Software Files", "Pe.Tools"), "firm");
  project = home(join(drive, ...pointer.split("/"), "Pe.Tools"), "project");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", user);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(user, { recursive: true, force: true });
  rmSync(drive, { recursive: true, force: true });
});

const terminal = snapshotOf({ nodes: [nodeOf(1, "terminal")] });
const PATHS: Partial<Record<DuctsCriteriaCell, readonly string[]>> = {
  terminalDropInWg: ["criteria", "terminalDropInWg"],
  velocitySupplyFpm: ["criteria", "velocityLimitFpm", "supply"],
  autoJoinGapIn: ["criteria", "autoJoinGapIn"],
};
/** The census, from the disk alone: the most specific mounted home whose file states the value. */
const servedBy = (cell: DuctsCriteriaCell, mounted: boolean) => {
  if (mounted)
    for (const [tier, root] of [["project", project], ["firm", firm]] as const) {
      const file = join(root, "Settings", "ducts.json");
      const stated = existsSync(file) ? PATHS[cell]!.reduce<unknown>((at, key) => (at !== null && typeof at === "object" ? Reflect.get(at, key) : undefined), JSON.parse(readFileSync(file, "utf8"))) : undefined;
      if (stated != null) return { tier, home: root, value: stated };
    }
  return { tier: "default" as const, home: null };
};
/** What the host serves and what the sheet draws from it: the setting cells, the criteria and a terminal's row. */
const sheet = async () => {
  const tiers = readSettingTiers("ducts", pointer);
  const files = await Effect.runPromise(Effect.service(DuctFiles).pipe(Effect.provide(DuctFiles.layer())));
  const base = firmLayer(resolveFirm(await Effect.runPromise(files.firm("ducts")), ductsFirmSchema, {}), tiers);
  const cells = sheetCells({ bindings: ductsSettings }, { rows: [], work: null, model: [], read: { settings: { ducts: tiers } } });
  return {
    tiers,
    cell: (name: DuctsCriteriaCell) => cells.find((cell) => cell.binding === `setting.ducts.${name}`)!,
    criteria: resolveCriteria(null, null, base),
    terminalDrop: resolveInputs({ snapshot: terminal, firm: base }).terminals["1"]!.drop,
  };
};
const sha = (tiers: Awaited<ReturnType<typeof sheet>>["tiers"], tier: "project" | "firm") => tiers.find((read) => read.tier === tier)!.sha256;

test.each(["firm", "project"] as const)("%s serves valid cells despite invalid siblings or unknown keys", async (tier) => {
  const root = tier === "firm" ? firm : project;
  expect(writeSettingTier({ owner: "ducts", tier, path: PATHS.velocitySupplyFpm!, value: 800, expectedSha256: null }, { pointer })).toMatchObject({ ok: true });
  // The original witness writes through the door; after validation lands, hand edits can still be invalid.
  writeSettingTier({ owner: "ducts", tier, path: PATHS.terminalDropInWg!, value: -1, expectedSha256: sha(readSettingTiers("ducts", pointer), tier) }, { pointer });
  const file = join(root, "Settings", "ducts.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.criteria.terminalDropInWg = -1;
  writeFileSync(file, JSON.stringify(json));
  for (const unknownKey of [false, true]) {
    if (unknownKey) {
      delete json.criteria.terminalDropInWg;
      writeFileSync(file, JSON.stringify({ ...json, handEdited: true }));
    }
    const at = await sheet();
    expect(at.cell("velocitySupplyFpm")).toMatchObject({ value: 800, source: tier });
    expect(at.criteria.velocityLimitFpm.supply).toMatchObject({ value: 800, source: tier });
    expect(at.criteria.terminalDropInWg).toMatchObject({ value: 0.03, source: "default" });
  }
});

test("FS steps 1, 2, 6 and 7: the sheet's tier label is the home the host served, and an unmounted firm home is never firm", async () => {
  // Before any write no home states a value: every label is the engine default.
  let at = await sheet();
  expect(at.cell("terminalDropInWg")).toMatchObject({ value: 0.03, source: "default" });
  expect(at.terminalDrop).toMatchObject({ value: 0.03, source: "default" });

  // Step 1: A sets terminal drop 0.03 to 0.05 at the firm tier. One notice names file, writer and receipt.
  const first = writeSettingTier({ owner: "ducts", tier: "firm", path: PATHS.terminalDropInWg!, value: 0.05, expectedSha256: sha(at.tiers, "firm") }, { pointer, writer: "A" });
  expect(first).toMatchObject({ ok: true, path: join(firm, "Settings", "ducts.json"), priorSha256: null, by: "A" });
  at = await sheet();
  expect(servedBy("terminalDropInWg", true)).toMatchObject({ tier: "firm", home: firm, value: 0.05 });
  expect(at.cell("terminalDropInWg")).toMatchObject({ value: 0.05, source: "firm" });
  expect(at.cell("terminalDropInWg").ref).toContain(`${basename(drive)} · A · `);
  expect(at.criteria.terminalDropInWg).toMatchObject({ value: 0.05, source: "firm" });
  expect(at.terminalDrop).toMatchObject({ value: 0.05, source: "firm" });
  // The auto-join gap is stated nowhere: default, though the firm file now exists.
  expect(at.cell("autoJoinGapIn").source).toBe(servedBy("autoJoinGapIn", true).tier);
  expect(at.criteria.autoJoinGapIn).toMatchObject({ value: 3, source: "default" });

  // Step 2: A overrides the supply velocity limit 900 to 800 at the project tier, over a firm 900.
  const firm900 = writeSettingTier({ owner: "ducts", tier: "firm", path: PATHS.velocitySupplyFpm!, value: 900, expectedSha256: sha(at.tiers, "firm") }, { pointer, writer: "A" });
  expect(firm900).toMatchObject({ ok: true, priorSha256: sha(at.tiers, "firm") });
  expect(writeSettingTier({ owner: "ducts", tier: "project", path: PATHS.velocitySupplyFpm!, value: 800, expectedSha256: null }, { pointer, writer: "A" })).toMatchObject({ ok: true, path: join(project, "Settings", "ducts.json") });
  at = await sheet();
  expect(servedBy("velocitySupplyFpm", true)).toMatchObject({ tier: "project", home: project, value: 800 });
  expect(at.cell("velocitySupplyFpm")).toMatchObject({ value: 800, source: "project", note: "overrides firm 900" });
  expect(at.cell("velocitySupplyFpm").ref).toContain("2026-014 Chadds Ford · A · ");
  expect(at.criteria.velocityLimitFpm.supply).toMatchObject({ value: 800, source: "project" });
  expect(at.criteria.velocityLimitFpm.return).toMatchObject({ value: 700, source: "default" });

  // Step 6: B changes the project value to 850. A stale hash is a conflict; the prior bytes stay recoverable.
  const before = readFileSync(join(project, "Settings", "ducts.json"));
  expect(writeSettingTier({ owner: "ducts", tier: "project", path: PATHS.velocitySupplyFpm!, value: 850, expectedSha256: null }, { pointer, writer: "B" })).toMatchObject({ ok: false, status: 409 });
  const second = writeSettingTier({ owner: "ducts", tier: "project", path: PATHS.velocitySupplyFpm!, value: 850, expectedSha256: sha(at.tiers, "project") }, { pointer, writer: "B" });
  expect(second).toMatchObject({ ok: true, by: "B", priorSha256: sha(at.tiers, "project") });
  expect(readFileSync(join(storedBlobsPath(), "sha256", sha(at.tiers, "project")!))).toEqual(before);
  at = await sheet();
  expect(at.cell("velocitySupplyFpm")).toMatchObject({ value: 850, source: "project" });
  expect(at.cell("velocitySupplyFpm").ref).toContain(" · B · ");
  const notices = readStoredNotices(storedNoticesPath()).filter((notice) => notice.place === SETTING_WRITE_PLACE && [join(firm, "Settings", "ducts.json"), join(project, "Settings", "ducts.json")].includes(notice.path ?? ""));
  expect(notices.map((notice) => notice.path)).toEqual([first, firm900, { path: join(project, "Settings", "ducts.json") }, second].map((wrote) => "path" in wrote ? wrote.path : undefined));
  expect(notices.at(-1)!.reason).toContain(`B set 850 at ducts criteria.velocityLimitFpm.supply in the project home`);
  expect(notices.at(-1)!.reason).toContain(`sha256 ${second.ok && second.priorSha256}`);

  // Step 7: the firm home is unmounted. Nothing is "firm"; the sheet says the home was not found.
  rmSync(join(firm, "pe-home.json"));
  at = await sheet();
  const labels = JSON.stringify([at.cell("terminalDropInWg"), at.cell("velocitySupplyFpm"), at.criteria, at.terminalDrop].map((value) => JSON.parse(JSON.stringify(value, (key, inner) => (key === "setting" || key === "home" || key === "domain" || key === "ref" ? undefined : inner)))));
  expect(labels).not.toContain('"firm"');
  expect(labels).not.toContain('"project"');
  for (const cell of ["terminalDropInWg", "velocitySupplyFpm", "autoJoinGapIn"] as const)
    expect(at.cell(cell).source).toBe(servedBy(cell, false).tier);
  expect(at.cell("terminalDropInWg").ref).toContain("firm home not found");
  expect(at.terminalDrop).toMatchObject({ value: 0.03, source: "default" });
  expect(at.tiers.find((read) => read.tier === "firm")).toMatchObject({ home: null });
  // A write at a home that was not found is refused, never written somewhere else.
  expect(writeSettingTier({ owner: "ducts", tier: "firm", path: PATHS.terminalDropInWg!, value: 0.07, expectedSha256: null }, { pointer })).toMatchObject({ ok: false, status: 404 });
});

test.each([-1, "0.05", {}, false])("the write door refuses invalid terminal drop %j without changing bytes or notices", (value) => {
  const before = readSettingTiers("ducts", pointer);
  const notices = readStoredNotices(storedNoticesPath());
  expect(writeSettingTier({ owner: "ducts", tier: "firm", path: PATHS.terminalDropInWg!, value, expectedSha256: null }, { pointer })).toMatchObject({ ok: false, status: 422 });
  expect(readSettingTiers("ducts", pointer)).toEqual(before);
  expect(readStoredNotices(storedNoticesPath())).toEqual(notices);
});

test("a declared cell can be cleared, but an undeclared owner or path cannot be written", async () => {
  const request = { owner: "ducts", tier: "firm" as const, path: PATHS.terminalDropInWg!, value: 0.05, expectedSha256: null };
  expect(writeSettingTier(request, { pointer })).toMatchObject({ ok: true });
  const expectedSha256 = sha(readSettingTiers("ducts", pointer), "firm");
  expect(writeSettingTier({ ...request, path: ["criteria", "unknown"], expectedSha256 }, { pointer })).toMatchObject({ ok: false, status: 422 });
  expect(writeSettingTier({ ...request, owner: "unknown" }, { pointer })).toMatchObject({ ok: false, status: 422 });
  expect(writeSettingTier({ ...request, value: null, expectedSha256 }, { pointer })).toMatchObject({ ok: true });
  const at = await sheet();
  expect(at.cell("terminalDropInWg")).toMatchObject({ value: 0.03, source: "default" });
  expect(at.criteria.terminalDropInWg).toMatchObject({ value: 0.03, source: "default" });
});

test.each(["written", "__proto__", "constructor", "prototype"])("the write door refuses reserved path key %s", (key) => {
  for (const path of [[key], ["criteria", key], [key, "terminalDropInWg"], ["parameters", key]]) {
    const before = readSettingTiers("ducts", pointer);
    const notices = readStoredNotices(storedNoticesPath());
    expect(writeSettingTier({ owner: "ducts", tier: "firm", path, value: 1, expectedSha256: null }, { pointer })).toMatchObject({ ok: false, status: 422, message: expect.stringContaining("reserved") });
    expect(readSettingTiers("ducts", pointer)).toEqual(before);
    expect(readStoredNotices(storedNoticesPath())).toEqual(notices);
  }
});

// Mutant: force the engine default 0.08 instead of the project friction 0.12.
test("design friction comes from the project home, never Work", async () => {
  expect(writeSettingTier({ owner: "ducts", tier: "firm", path: ["designFriction"], value: 0.08, expectedSha256: null }, { pointer })).toMatchObject({ ok: true });
  expect(writeSettingTier({ owner: "ducts", tier: "project", path: ["designFriction"], value: 0.12, expectedSha256: null }, { pointer })).toMatchObject({ ok: true });
  const tiers = readSettingTiers("ducts", pointer);
  const cells = sheetCells({ bindings: ductsSettings }, { rows: [], work: null, model: [], read: { settings: { ducts: tiers } } });
  expect(cells.find(cell => cell.binding === "setting.ducts.designFriction")).toMatchObject({ value: 0.12, source: "project" });
  expect(price(snapshot, {}, null, neutralFansWork, {}, tiers).edit.designFriction).toBe(0.12);
  expect(ductsDocumentSchema.parse({})).not.toHaveProperty("designFriction");
  expect(ductsDocumentSchema.safeParse({ designFriction: {} }).success).toBe(false);
});

// Mutant: ignore the project tier and serve firm slot names.
test("snapshot slot names come from the project home, never Fans Work", () => {
  expect(writeSettingTier({ owner: "ducts", tier: "firm", path: ["parameters", "fanFlow"], value: "Firm flow", expectedSha256: null }, { pointer })).toMatchObject({ ok: true });
  expect(writeSettingTier({ owner: "ducts", tier: "project", path: ["parameters", "fanFlow"], value: "Project flow", expectedSha256: null }, { pointer })).toMatchObject({ ok: true });
  const tiers = readSettingTiers("ducts", pointer);
  const cells = sheetCells({ bindings: Object.fromEntries(Object.entries(fansSheet.bindings).filter(([key]) => key.startsWith("setting."))) }, { rows: [], work: null, model: [], read: { settings: { ducts: tiers } } });
  expect(cells.find(cell => cell.binding === "setting.ducts.parameters.fanFlow")).toMatchObject({ value: "Project flow", source: "project" });
  expect(ductParameterSlots(tiers)).toEqual({ fanFlow: "Project flow" });
  expect(fansDocumentSchema.parse({})).not.toHaveProperty("parameters");
  expect(fansDocumentSchema.safeParse({ parameters: {} }).success).toBe(false);
});

// Mutant H5-caption: claim a missing firm file supplied the seed.
test("the pricing caption calls an absent firm file defaults, never firm seed", () => {
  const read = fansSheetData.parse({
    open: null, rows: [], progress: null, espOptions: null, espOptionsError: null,
    ductsRevision: 0, ductsWork: {}, fansWork: {}, design: {}, settings: {},
    sheetSnapshot: { kind: "absent" },
    fans: { target: { session: "test", openId: "doc" }, slots: [], activeSlot: "", rows: [] },
    sheetView: { blockers: [], tiers: { taken: 0, accept: 0, preview: 0 }, taken: [], inputs: null,
      firm: { version: "seed", path: "Settings/ducts.json", present: false } },
  });
  const caption = fansSheet.from(read, {})!.says;
  expect(caption).toContain("defaults");
  expect(caption).not.toContain("over firm");
});

// Mutant H5-empty-default: omit the binding fallback while the engine still prices it.
test("all eight criteria display the engine defaults when the firm marker is gone", async () => {
  rmSync(join(firm, "pe-home.json"));
  const at = await sheet();
  const expected = { velocitySupplyFpm: 900, velocityReturnFpm: 700, terminalDropInWg: 0.03, autoJoinGapIn: 3, healBoxIn: 36, splitPolicy: "even", allowanceSupplyInWg: 0, allowanceReturnInWg: 0 };
  for (const cell of ductsDocumentSchema.shape.criteria.unwrap().keyof().options)
    expect(at.cell(cell)).toMatchObject({ value: expected[cell], source: "default" });
});

// Mutant H5-marker-blame: skip the shared-drive-root absence branch.
test("a present project marker is not blamed when the firm home cannot anchor its relative pointer", () => {
  rmSync(join(firm, "pe-home.json"));
  expect(existsSync(join(project, "pe-home.json"))).toBe(true);
  const reason = readSettingTiers("ducts", pointer).find(read => read.tier === "project")!.notFound!;
  expect(reason).toContain(pointer);
  expect(reason).toContain("relative to the shared drive root");
  expect(reason).toContain("no firm home");
  expect(reason).not.toContain("no folder with");
});

test("the write door refuses an unknown parameter slot", () => {
  const before = readSettingTiers("ducts", pointer);
  const notices = readStoredNotices(storedNoticesPath());
  expect(writeSettingTier({ owner: "ducts", tier: "firm", path: ["parameters", "bogusSlot"], value: "X", expectedSha256: null }, { pointer })).toMatchObject({ ok: false, status: 422 });
  expect(readSettingTiers("ducts", pointer)).toEqual(before);
  expect(readStoredNotices(storedNoticesPath())).toEqual(notices);
});

test.each([
  [["designFriction"], -1],
  [["designFriction"], 0],
  [["parameters", "fanFlow", "extra"], "Flow"],
  [["parameters", "fanFlow"], ""],
] as const)("the settings door refuses invalid %j = %j without writes or notices", (path, value) => {
  const before = readSettingTiers("ducts", pointer);
  const notices = readStoredNotices(storedNoticesPath());
  expect(writeSettingTier({ owner: "ducts", tier: "firm", path, value, expectedSha256: null }, { pointer })).toMatchObject({ ok: false, status: 422 });
  expect(readSettingTiers("ducts", pointer)).toEqual(before);
  expect(readStoredNotices(storedNoticesPath())).toEqual(notices);
});

test("design friction can be cleared with null", () => {
  const request = { owner: "ducts", tier: "project" as const, path: ["designFriction"], value: 0.12, expectedSha256: null };
  expect(writeSettingTier(request, { pointer })).toMatchObject({ ok: true });
  const expectedSha256 = sha(readSettingTiers("ducts", pointer), "project");
  expect(writeSettingTier({ ...request, value: null, expectedSha256 }, { pointer })).toMatchObject({ ok: true });
  const read = readSettingTiers("ducts", pointer).find(read => read.tier === "project")!;
  expect(read.json).not.toHaveProperty("designFriction");
  expect(price(snapshot, {}, null, neutralFansWork, {}, readSettingTiers("ducts", pointer)).edit.designFriction).toBe(0.08);
});

// Mutant W3-project: drop watchSettingTiers' filesystem watch; an outside writer stays silent.
test("an outside project rewrite invalidates once and the sheet reads its value and source", async () => {
  const tier = "project";
  const root = project;
  mkdirSync(join(root, "Settings"), { recursive: true });
  const path = join(root, "Settings", "ducts.json");
  const bytes = (value: number) => JSON.stringify({ criteria: { velocityLimitFpm: { supply: value } } });
  writeFileSync(path, bytes(800));
  let changes = 0;
  const watching = watchSettingTiers(() => changes++);
  try {
    watching.read("ducts", pointer);
    expect((await sheet()).cell("velocitySupplyFpm")).toMatchObject({ value: 800, source: tier });
    writeFileSync(path, bytes(850));
    await expect.poll(() => changes).toBe(1);
    expect((await sheet()).cell("velocitySupplyFpm")).toMatchObject({ value: 850, source: tier });
    // Repeated hints with identical bytes must not publish another change.
    writeFileSync(path, bytes(850));
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(changes).toBe(1);
  } finally {
    watching.close();
  }
});

test("an unregistered owner is invalid even before a home can be resolved", () => {
  expect(writeSettingTier({ owner: "not-declared", tier: "firm", path: ["x"], value: 1, expectedSha256: null }, { pointer }))
    .toMatchObject({ ok: false, status: 422 });
});
test.each([["user", ["designFriction"]], ["project", ["criteria"]]] as const)("an owner cannot write undeclared tier/path %s %j", (tier, path) => {
  expect(writeSettingTier({ owner: "ducts", tier, path, value: null, expectedSha256: null }, { pointer })).toMatchObject({ ok: false, status: 422 });
});
