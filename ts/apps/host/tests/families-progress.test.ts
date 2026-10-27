import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";

test("progress survives reconstruction, shares family blobs, and never replaces a completed plan baseline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "families-progress-"));
  const captures = new TakeoffCaptures(dir);
  const document = { session: "s", openId: "o" };
  const filter = {
    categoryNames: ["Air Terminals"],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  const work = bindWork("families", address("C:/air.rvt"), undefined, document);
  const family = {
    familyId: 1,
    familyUniqueId: "u1",
    familyName: "Air",
    typeNames: [],
    parameters: [],
    issues: [],
    isPartial: false,
    placedInstanceCount: 0,
  };
  const base = {
    work,
    document,
    filter,
    capturedAt: new Date().toISOString(),
    result: { families: [family], issues: [], page: null },
  };
  try {
    const complete = await captures.saveFamilies(base);
    const frames: unknown[] = [];
    const release = captures.observeFamiliesMatrix(document, filter, (value) => frames.push(value));
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const first = await captures.saveFamiliesProgress({
      ...base,
      progress: {
        runId: "r",
        state: "reading",
        phase: "Reading",
        completed: 1,
        total: 2,
        workers: 1,
      },
    });
    const cancelled = await captures.saveFamiliesProgress({
      ...base,
      progress: {
        runId: "r",
        state: "cancelled",
        phase: "Cancelled",
        completed: 1,
        total: 2,
        workers: 1,
      },
    });
    expect((await new TakeoffCaptures(dir).families(first.id)).result.families).toEqual([family]);
    // A stored "reading" revision whose run is not live here can never finish; it must not spin.
    expect((await new TakeoffCaptures(dir).families(first.id)).progress).toMatchObject({
      state: "failed",
    });
    expect((await captures.families(cancelled.id)).progress?.state).toBe("cancelled");
    expect((await captures.latestFamilies(work))?.id).toBe(complete.id);
    expect((await new TakeoffCaptures(dir).displayedFamilies(work))?.id).toBe(cancelled.id);
    expect(await captures.familiesReadings()).toHaveLength(1);
    expect(await readdir(join(dir, "families", "records"))).toHaveLength(1);
    const parts = await captures.familiesParts(cancelled.id);
    expect(parts.reading.result.families).toEqual([]);
    expect(parts.records).toHaveLength(1);
    expect(JSON.parse((await captures.familyRecord(parts.records![0]!)).toString())).toEqual(
      family,
    );
    const reference = await captures.familiesReference(cancelled.id);
    expect(JSON.parse(await readFile(reference.artifact.path, "utf8")).progress.state).toBe(
      "cancelled",
    );
    expect(await captures.familiesReadings()).toHaveLength(1);
    await vi.waitFor(() => expect(JSON.stringify(frames)).toContain(cancelled.id));
    expect(JSON.stringify(frames)).not.toContain('"familyName"');
    release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
