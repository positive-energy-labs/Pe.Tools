import { loadRunReport, type ZoneRecord } from "../world";

import { fb, itemKey, type StagedItem } from "./staging";

type ManifestItem = {
  zone: string;
  level: string;
  runA: string | null;
  runB: string;
  flags: string[] | null;
  note: string | null;
  stagedAt: number | null;
};

type Manifest = { stamp: string | null; items: ManifestItem[] };

async function zoneFrom(runId: string | null, zone: string): Promise<ZoneRecord | null> {
  if (!runId) return null;
  try {
    const report = await loadRunReport(runId);
    return report.Zones.find((z) => z.Zone === zone) ?? null;
  } catch {
    return null;
  }
}

export async function hydrateFromSet(setStamp: string): Promise<void> {
  const res = await fetch(`/api/runs-data/_exports/${encodeURIComponent(setStamp)}/manifest.json`);
  if (!res.ok) throw new Error(`set ${setStamp}: manifest fetch ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  if (!Array.isArray(manifest.items)) throw new Error(`set ${setStamp}: manifest has no items`);

  const items: StagedItem[] = await Promise.all(
    manifest.items.map(async (m): Promise<StagedItem> => {
      const [a, b] = await Promise.all([zoneFrom(m.runA, m.zone), zoneFrom(m.runB, m.zone)]);
      return {
        key: itemKey(m.zone, m.runA, m.runB),
        zone: m.zone,
        level: m.level,
        runA: m.runA,
        runB: m.runB,
        a,
        b,
        flags: m.flags ?? [],
        note: m.note ?? "",
        stagedAt: m.stagedAt ?? Date.now(),
      };
    }),
  );
  fb.replaceAll(items, manifest.stamp ?? setStamp);
}
