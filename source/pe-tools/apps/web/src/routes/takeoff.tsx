import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Play, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { fmtNum } from "#/rhvac/cells";
import { loadFixtureExtract } from "#/rhvac/fixture";
import type { RhvacExtract } from "#/rhvac/types";
import {
  reconcileRows,
  runExport,
  toExportRoom,
  type ExportResponse,
  type StagedRoomEdit,
} from "#/takeoff/export";
import {
  applyRegistry,
  partitionZone,
  readStatus,
  readZoneRegions,
  writeDecisions,
} from "#/takeoff/host";
import {
  DEFAULT_ARTIFACT_DIR,
  FLAG_MEANING,
  LEVEL_LANES,
  buildZones,
  decisionRows,
  readResolutions,
  regionForRoom,
  upsertResolution,
  zoneStage,
  type DecisionRow,
  type ModelStatus,
  type PartitionRun,
  type RegistryState,
  type Zone,
} from "#/takeoff/model";
import { Live, Seam, Step } from "#/takeoff/seam";
import { PlanLegend, ZonePlan, ZoneThumb } from "#/takeoff/zone-plan";
import { VariantSwitcher } from "#/takeoff/proto/switcher";
import { Variant as ZonesVariant } from "#/takeoff/proto/variant-zones";
import { Variant as HouseVariant } from "#/takeoff/proto/variant-house";
import { Variant as InboxVariant } from "#/takeoff/proto/variant-inbox";
import { Variant as PeaVariant } from "#/takeoff/proto/variant-pea";
import { cn } from "#/lib/utils";

/**
 * /takeoff — the takeoff pipeline as one page, and as its own specification.
 *
 * source/Pe.Revit.Takeoff/README.md describes seven steps, each with one owner and one home.
 * This route walks them in order against the LIVE document: register writes the System registry
 * blob, partition replays the level capture masked to one zone and materializes Room Region FRs
 * into the real zoning view, every accept/dismiss writes through to the region's provenance blob
 * before the UI believes it, and export runs the .r10 safety envelope on a copy.
 *
 * Where a stage stands in for something that does not exist yet, it carries a `seam:` chip
 * naming its replacement. The page is honest about which half it is in — that is the point.
 */
/** PROTOTYPE — UX exploration round 1: five structurally different shapes for this surface,
 *  switchable via ?variant= (see src/takeoff/proto/). "spec" is the pre-existing page. */
const VARIANTS = [
  { key: "spec", name: "pipeline spec (current)" },
  { key: "zones", name: "zone-first workbench" },
  { key: "house", name: "house as system" },
  { key: "inbox", name: "decision inbox" },
  { key: "pea", name: "chat-native workspace" },
];

export const Route = createFileRoute("/takeoff")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: VARIANTS.some((v) => v.key === search.variant) ? (search.variant as string) : "spec",
  }),
  component: VariantGate,
});

function VariantGate() {
  const { variant } = Route.useSearch();
  return (
    <>
      {variant === "spec" && <TakeoffRoute />}
      {variant === "zones" && <ZonesVariant />}
      {variant === "house" && <HouseVariant />}
      {variant === "inbox" && <InboxVariant />}
      {variant === "pea" && <PeaVariant />}
      <VariantSwitcher variants={VARIANTS} current={variant} />
    </>
  );
}

/** Default .r10 for the export lane; the endpoint always syncs a COPY of whatever this names. */
const DEFAULT_R10 = "C:\\Users\\kaitp\\source\\repos\\Pe.Tools\\eval\\rhvac\\project-a\\projectA.local.r10";

function TakeoffRoute() {
  const zones = useMemo(() => buildZones(), []);

  const [artifactDir, setArtifactDir] = useState(DEFAULT_ARTIFACT_DIR);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [registry, setRegistry] = useState<RegistryState | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** Typed System tags per zone. seam: these belong on the Zoning Region FR (step 1). */
  const [tagsByZone, setTagsByZone] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, PartitionRun>>({});
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  const [extract, setExtract] = useState<RhvacExtract | null>(null);
  const [staged, setStaged] = useState<Record<number, StagedRoomEdit>>({});
  const [r10Path, setR10Path] = useState(DEFAULT_R10);
  const [exportResult, setExportResult] = useState<ExportResponse | null>(null);

  const selected = zones.find((z) => z.key === selectedKey) ?? null;
  const run = selectedKey ? (runs[selectedKey] ?? null) : null;

  const guard = useCallback(async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setHostError(null);
    try {
      await work();
    } catch (caught) {
      setHostError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshStatus = useCallback(
    () =>
      guard("status", async () => {
        setStatus(await readStatus());
      }),
    [guard],
  );

  useEffect(() => {
    void refreshStatus();
    loadFixtureExtract()
      .then(setExtract)
      .catch(() => setExtract(null));
  }, [refreshStatus]);

  /** Materialized-room census per zone GUID, from the live document. */
  const roomsByZoneGuid = useMemo(
    () => new Map((status?.regions ?? []).map((r) => [r.zoneGuid, r.rooms])),
    [status],
  );

  const tagsOf = (zone: Zone) =>
    (tagsByZone[zone.key] ?? "")
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);

  const allObserved = useMemo(
    () => [...new Set(zones.flatMap((z) => tagsOf(z)))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zones, tagsByZone],
  );

  const registerZone = (zone: Zone) =>
    guard(`register:${zone.key}`, async () => {
      const tags = tagsOf(zone);
      if (tags.length === 0) throw new Error(`${zone.key} has no System tags to register`);
      setRegistry(await applyRegistry({ observed: allObserved, register: tags, renames: [] }));
      setStatus(await readStatus());
    });

  const answerRename = (fromGuid: string, toTag: string) =>
    guard("rename", async () => {
      setRegistry(
        await applyRegistry({ observed: allObserved, register: [], renames: [{ guid: fromGuid, toTag }] }),
      );
    });

  const registerAsNew = (tag: string) =>
    guard("register-new", async () => {
      setRegistry(await applyRegistry({ observed: allObserved, register: [tag], renames: [] }));
    });

  const partition = (zone: Zone) =>
    guard(`partition:${zone.key}`, async () => {
      const result = await partitionZone({
        replayPath: `${artifactDir.replace(/[\\/]+$/, "")}\\${zone.lane.replayFile}`,
        view: zone.lane.view,
        levelFragment: zone.lane.levelFragment,
        zoneName: zone.key,
        zoneGuid: zone.guid,
        runId: `web-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
        loops: zone.loops,
      });
      setRuns((prev) => ({ ...prev, [zone.key]: result }));
      setStatus(await readStatus());
    });

  /**
   * Write-through review: the verb hits the region's provenance blob first, and the queue only
   * shows it as decided once the live re-read confirms it. No batch commit, no sidecar.
   */
  const decide = (row: DecisionRow, verb: "accept" | "dismiss") =>
    guard(`decide:${row.key}`, async () => {
      if (!selected || !run) throw new Error("no zone run in scope");
      if (row.elementId === null)
        throw new Error(`${row.subject} has no Room Region to write to — nothing to decide yet`);
      const region = run.regions.find((r) => r.elementId === row.elementId);
      if (!region) throw new Error(`region ${row.elementId} vanished from the run`);
      const next = upsertResolution(readResolutions(region.blob), {
        subject: row.subject,
        flag: row.flag,
        verb,
        at: new Date().toISOString(),
        runId: `web-${Date.now()}`,
      });
      await writeDecisions(row.elementId, next);
      const regions = await readZoneRegions({ view: selected.lane.view, zoneGuid: selected.guid });
      setRuns((prev) => ({ ...prev, [selected.key]: { ...run, regions } }));
    });

  const rows = run ? decisionRows(run) : [];
  const pending = rows.filter((r) => !r.resolved);

  // ── Step 5: rooms of the partitioned zone, joined to .r10 room data ────────
  const joined = useMemo(() => {
    if (!run || !extract) return [];
    return run.rooms.map((room) => {
      // seam: the real join is the .r10 link in the Room Region's provenance blob
      // ({file identity, room Identifier}); until export writes it, match on area.
      const match = extract.rooms
        .map((r) => ({ r, delta: Math.abs(r.areaSquareFeet - room.rawSqft) }))
        .sort((a, b) => a.delta - b.delta)[0];
      return { room, rhvac: match && match.delta <= room.rawSqft * 0.15 ? match.r : null };
    });
  }, [run, extract]);

  const stagedList = Object.values(staged);

  const doExport = (whatIf: boolean) =>
    guard("export", async () => {
      if (!extract) throw new Error("no .r10 extract loaded");
      const byId = new Map(extract.rooms.map((r) => [r.identifier, r]));
      const updates = stagedList.map((edit) => {
        const room = byId.get(edit.identifier);
        if (!room) throw new Error(`staged edit for unknown room ${edit.identifier}`);
        return toExportRoom(room, edit);
      });
      setExportResult(await runExport({ sourcePath: r10Path, updates, whatIf }));
    });

  return (
    <main className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <h1 className="font-pe-display text-lg font-semibold tracking-tight">Takeoff</h1>
        <span className="tele text-muted-foreground">
          zones → rooms → Manual J → .r10 — the pipeline, live
        </span>
        {status && <Live>{status.doc}</Live>}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="tele-label text-muted-foreground">artifacts</span>
          <Input
            value={artifactDir}
            onChange={(e) => setArtifactDir(e.target.value)}
            className="tele h-7 w-80"
          />
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void refreshStatus()}>
            {busy === "status" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        </div>
      </header>

      {hostError && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {hostError}
        </p>
      )}

      <div className="space-y-6 px-4 py-4">
        {/* ── Steps 1 + 2 ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <Step n={1} title="Declare zones" owner="designer" home="Zoning Region FRs">
            <Seam>
              zones read from a committed fixture of the 45 real project-a FRs; the real source is
              the validate op reading Zoning Region FRs once they carry role/GUID/tag params
            </Seam>
          </Step>
          <Step n={2} title="Validate + register" owner="op" home="System registry blob">
            <Live>SystemRegistry through TakeoffCarriers on Project Information</Live>
          </Step>

          {registry?.needsHuman && (
            <ReconcileQuestions
              registry={registry}
              disabled={busy !== null}
              onRename={answerRename}
              onNew={registerAsNew}
            />
          )}

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {LEVEL_LANES.map((lane) => (
              <div key={lane.view} className="rounded-[var(--radius)] border border-[var(--line)]">
                <p className="section-label border-b border-[var(--line)] px-2 py-1">
                  {lane.label}
                  <span className="tele ml-1.5 normal-case text-muted-foreground">
                    {zones.filter((z) => z.lane.view === lane.view).length} zones
                  </span>
                </p>
                <ul className="divide-y divide-[var(--line-soft)]">
                  {zones
                    .filter((z) => z.lane.view === lane.view)
                    .map((zone) => {
                      const materialized = roomsByZoneGuid.get(zone.guid) ?? 0;
                      const stage = zoneStage(tagsOf(zone), materialized);
                      return (
                        <li
                          key={zone.key}
                          className={cn(
                            "flex items-center gap-1.5 px-1.5 py-1",
                            selectedKey === zone.key && "bg-primary/5",
                          )}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            onClick={() => {
                              setSelectedKey(zone.key);
                              setSelectedSubject(null);
                            }}
                          >
                            <ZoneThumb zone={zone} />
                            <span className="min-w-0">
                              <span className="tele block truncate">{zone.key}</span>
                              <span className="tele block text-muted-foreground">
                                {fmtNum(zone.declaredSqft, 0)} sf declared
                                {materialized > 0 && ` · ${materialized} rooms`}
                              </span>
                            </span>
                          </button>
                          <StageChip stage={stage} />
                          <Input
                            value={tagsByZone[zone.key] ?? ""}
                            placeholder="FC-8, FC-13"
                            onChange={(e) =>
                              setTagsByZone((prev) => ({ ...prev, [zone.key]: e.target.value }))
                            }
                            className="tele h-6 w-24 shrink-0"
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busy !== null || tagsOf(zone).length === 0}
                            onClick={() => void registerZone(zone)}
                          >
                            register
                          </Button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>

          {registry && registry.systems.length > 0 && (
            <p className="tele text-muted-foreground">
              registry:{" "}
              {registry.systems.map((s) => `${s.tag} (${s.guid.slice(0, 8)})`).join(" · ")}
            </p>
          )}
        </section>

        {/* ── Steps 3 + 4 ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <Step n={3} title="Partition" owner="op" home="Room Region + held FRs">
            <Live>DetectSnapshot.ReplayInferred masked to the zone → ZoneMaterializer</Live>
            <Seam>
              the promotion gate (TakeoffPromotion.PromoteZone) is internal and unreachable from
              scripting — what materializes here is the raw detector partition
            </Seam>
          </Step>
          <Step n={4} title="Edit" owner="designer" home="Room Region FRs">
            <Seam>
              shapes change only in Revit's sketch editor — this page never edits geometry; a
              rerun re-binds edited regions by label containment and area
            </Seam>
          </Step>

          {!selected ? (
            <p className="tele text-muted-foreground">pick a zone above to partition it.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-[var(--radius)] border border-[var(--line)]">
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-2 py-1.5">
                  <span className="section-label">{selected.key}</span>
                  <span className="tele text-muted-foreground">
                    {selected.lane.view} · {fmtNum(selected.declaredSqft, 0)} sf declared ·{" "}
                    {selected.guid.slice(0, 8)}
                  </span>
                  <Button
                    size="xs"
                    className="ml-auto"
                    disabled={busy !== null}
                    onClick={() => void partition(selected)}
                  >
                    {busy === `partition:${selected.key}` ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Play />
                    )}
                    Partition zone
                  </Button>
                </div>
                <div className="h-[22rem]">
                  <ZonePlan
                    zone={selected}
                    run={run}
                    selectedSubject={selectedSubject}
                    onSelect={setSelectedSubject}
                  />
                </div>
                <div className="border-t border-[var(--line)] px-2 py-1">
                  <PlanLegend run={run} />
                </div>
              </div>

              <div className="space-y-2">
                {run ? (
                  <>
                    <Accounting run={run} zone={selected} />
                    <div className="rounded-[var(--radius)] border border-[var(--line)]">
                      <p className="section-label border-b border-[var(--line)] px-2 py-1">
                        detected rooms
                        <span className="tele ml-1.5 normal-case text-muted-foreground">
                          {run.rooms.length}
                        </span>
                      </p>
                      <ul className="max-h-56 divide-y divide-[var(--line-soft)] overflow-y-auto">
                        {run.rooms.map((room) => {
                          const region = regionForRoom(room, run.regions);
                          return (
                            <li
                              key={room.id}
                              className={cn(
                                "flex cursor-pointer items-baseline gap-1.5 px-2 py-0.5",
                                selectedSubject === room.id && "bg-primary/5",
                              )}
                              onClick={() => setSelectedSubject(room.id)}
                            >
                              <span className="tele w-8">{room.id}</span>
                              <span className="tele w-14 text-right">
                                {fmtNum(room.rawSqft, 0)} sf
                              </span>
                              <span className="tele w-14 text-right text-muted-foreground">
                                {fmtNum(room.meanCeilingFt, 1)} ft
                              </span>
                              <span className="tele min-w-0 flex-1 truncate text-cat-clay">
                                {room.flags.join(" · ")}
                              </span>
                              <span className="tele shrink-0 text-muted-foreground">
                                {region ? `#${region.elementId}` : "no region"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </>
                ) : (
                  <p className="tele text-muted-foreground">
                    no run in this session. Partitioning replays{" "}
                    <span className="text-foreground">{selected.lane.replayFile}</span> masked to
                    this zone and materializes into{" "}
                    <span className="text-foreground">{selected.lane.view}</span>.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Review ────────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <Step n="3b" title="Review" owner="designer" home="provenance blob on the Room Region">
            <Live>each verb writes through to the FR blob before the row reads as decided</Live>
          </Step>
          <p className="tele text-muted-foreground">
            two verbs: <span className="text-foreground">accept</span> takes the recalculation's
            proposal · <span className="text-foreground">dismiss</span> keeps the designer's state.
            Geometry never changes here.
          </p>
          {rows.length === 0 ? (
            <p className="tele text-muted-foreground">
              {run ? "nothing to decide in this zone." : "partition a zone to populate the queue."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)] rounded-[var(--radius)] border border-[var(--line)]">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className={cn(
                    "flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1",
                    selectedSubject === row.subject && "bg-primary/5",
                    row.resolved && "opacity-55",
                  )}
                >
                  <button
                    type="button"
                    className="tele w-16 shrink-0 text-left hover:underline"
                    onClick={() => setSelectedSubject(row.subject)}
                  >
                    {row.subject}
                  </button>
                  <span className="tele w-40 shrink-0 text-cat-clay">{row.flag}</span>
                  <span className="tele w-16 shrink-0 text-right text-muted-foreground">
                    {row.sqft === null ? "—" : `${fmtNum(row.sqft, 0)} sf`}
                  </span>
                  <span className="tele min-w-0 flex-1 truncate text-muted-foreground">
                    {row.detail}
                  </span>
                  {row.resolved ? (
                    <span className="tele shrink-0">
                      {row.resolved.verb} · {row.resolved.at.slice(0, 16).replace("T", " ")}
                    </span>
                  ) : (
                    <span className="flex shrink-0 gap-0.5">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy !== null || row.elementId === null}
                        title={row.elementId === null ? "no Room Region to write to" : undefined}
                        onClick={() => void decide(row, "accept")}
                      >
                        accept
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy !== null || row.elementId === null}
                        onClick={() => void decide(row, "dismiss")}
                      >
                        dismiss
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pending.length > 0 && (
            <p className="tele text-muted-foreground">
              {pending.length} pending ·{" "}
              {[...new Set(pending.map((r) => r.flag))]
                .map((f) => FLAG_MEANING[f] ?? f)
                .slice(0, 2)
                .join(" · ")}
            </p>
          )}
        </section>

        {/* ── Step 5 ────────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <Step n={5} title="Room data" owner="designer" home="the .r10">
            <Live>rows read from the project-a extract fixture</Live>
            <Seam>
              rooms join to .r10 rows by nearest area; the real join is the {"{file, Identifier}"}{" "}
              link export writes into the Room Region blob
            </Seam>
            <Seam>assists (lighting 0.25 W/sf, people by bedrooms, OA/exhaust) not wired</Seam>
          </Step>
          {joined.length === 0 ? (
            <p className="tele text-muted-foreground">partition a zone to see its room data.</p>
          ) : (
            <table className="w-full max-w-4xl border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {["room", "detected sf", ".r10 room", "name", "area sf", "sys"].map((h) => (
                    <th key={h} className="section-label py-1 pr-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {joined.map(({ room, rhvac }) => {
                  const edit = rhvac ? staged[rhvac.identifier] : undefined;
                  return (
                    <tr key={room.id} className="border-b border-[var(--line-soft)]">
                      <td className="tele py-0.5 pr-3">{room.id}</td>
                      <td className="tele py-0.5 pr-3">{fmtNum(room.rawSqft, 0)}</td>
                      <td className="tele py-0.5 pr-3 text-muted-foreground">
                        {rhvac ? `#${rhvac.number}` : "unmatched"}
                      </td>
                      <td className="py-0.5 pr-3">
                        {rhvac && (
                          <Input
                            defaultValue={rhvac.name}
                            className="tele h-6 w-44"
                            onBlur={(e) =>
                              setStaged((prev) => ({
                                ...prev,
                                [rhvac.identifier]: {
                                  ...prev[rhvac.identifier],
                                  identifier: rhvac.identifier,
                                  name: e.target.value,
                                },
                              }))
                            }
                          />
                        )}
                      </td>
                      <td className="py-0.5 pr-3">
                        {rhvac && (
                          <Input
                            defaultValue={String(rhvac.areaSquareFeet)}
                            className="tele h-6 w-20"
                            onBlur={(e) =>
                              setStaged((prev) => ({
                                ...prev,
                                [rhvac.identifier]: {
                                  ...prev[rhvac.identifier],
                                  identifier: rhvac.identifier,
                                  areaSquareFeet: Number(e.target.value),
                                },
                              }))
                            }
                          />
                        )}
                      </td>
                      <td className="tele py-0.5 text-muted-foreground">
                        {rhvac?.systemNumber ?? "—"}
                        {edit && <span className="ml-1 text-cat-clay">staged</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Steps 6 + 7 ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <Step n={6} title="Export" owner="op" home="the .r10">
            <Live>eval/rhvac/sync-rhvac.ps1 — copy → validate → atomic swap + backup</Live>
            <Seam>
              runs through a dev-lane endpoint that spawns PowerShell; belongs behind an
              `rhvac.sync` host op. The named file is always COPIED to a scratch dir first
            </Seam>
          </Step>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tele-label text-muted-foreground">.r10</span>
            <Input
              value={r10Path}
              onChange={(e) => setR10Path(e.target.value)}
              className="tele h-7 min-w-96 flex-1 max-w-[46rem]"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || stagedList.length === 0}
              onClick={() => void doExport(true)}
            >
              Validate only
            </Button>
            <Button
              size="sm"
              disabled={busy !== null || stagedList.length === 0}
              onClick={() => void doExport(false)}
            >
              {busy === "export" ? <Loader2 className="animate-spin" /> : <Upload />}
              Export {stagedList.length} edit{stagedList.length === 1 ? "" : "s"}
            </Button>
          </div>
          {exportResult && (
            <div className="space-y-1 rounded-[var(--radius)] border border-[var(--line)] p-2">
              <p className="tele">
                <span className={exportResult.ok ? "text-cat-blue" : "text-destructive"}>
                  exit {exportResult.exitCode}
                </span>{" "}
                · working copy {exportResult.workingTarget}
                {exportResult.backupPath && ` · backup ${exportResult.backupPath}`}
              </p>
              <pre className="tele max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">
                {exportResult.stdout || exportResult.stderr || "(no output)"}
              </pre>
              <p className="tele text-muted-foreground">{exportResult.command}</p>
            </div>
          )}

          <Step n={7} title="Reconcile" owner="op" home="report only — writes nothing">
            <Seam>
              the tag join is registry ↔ .r10 System numbers; the real join reads the tag out of
              the exported RHVAC System name, plus equipment PE_G___TagInstance and the FOM
              workbook
            </Seam>
          </Step>
          <table className="max-w-2xl border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--line)]">
                {["tag", "registry", ".r10 system", "rooms", "verdict"].map((h) => (
                  <th key={h} className="section-label py-1 pr-4 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reconcileRows(status?.systems ?? [], extract).map((row) => (
                <tr key={`${row.tag}:${row.rhvacSystemNumber}`} className="border-b border-[var(--line-soft)]">
                  <td className="tele py-0.5 pr-4">{row.tag}</td>
                  <td className="tele py-0.5 pr-4 text-muted-foreground">
                    {row.registryGuid?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="tele py-0.5 pr-4 text-muted-foreground">
                    {row.rhvacSystemNumber ?? "—"}
                  </td>
                  <td className="tele py-0.5 pr-4 text-muted-foreground">{row.rooms || "—"}</td>
                  <td className="tele py-0.5 text-cat-clay">
                    {row.registryGuid && row.rhvacSystemNumber
                      ? "joined"
                      : row.registryGuid
                        ? "registry only — not exported yet"
                        : "in the .r10, unknown to the registry"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function StageChip({ stage }: { stage: ReturnType<typeof zoneStage> }) {
  const tone =
    stage === "partitioned"
      ? "border-cat-blue/40 bg-cat-blue/10 text-cat-blue"
      : stage === "registered"
        ? "border-cat-clay/40 bg-cat-clay/10 text-cat-clay"
        : "border-[var(--line)] text-muted-foreground";
  return (
    <span className={cn("tele-label shrink-0 rounded-[var(--radius)] border px-1 py-px", tone)}>
      {stage}
    </span>
  );
}

/**
 * Accounting closure, per zone. The law: accepted + held + excluded equals the domain plus the
 * wall band claimed into rooms, exactly. `declared` is the designer's Zoning Region area — the
 * gap between it and `domain` is what the capture window and the detector's habitability rules
 * excluded before the partition ever ran, and it is shown rather than absorbed.
 */
function Accounting({ run, zone }: { run: PartitionRun; zone: Zone }) {
  // TakeoffResult.TotalSqft is the ROOM sum only; residues are their own list.
  const residueSqft = run.residues.reduce((sum, r) => sum + r.rawSqft, 0);
  const closure =
    run.totalSqft + residueSqft + run.excludedResidueSqft - run.domainSqft - run.claimedWallSqft;
  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] p-2">
      <p className="section-label mb-1">accounting</p>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <Metric label="created" value={run.created} />
        <Metric label="rebound" value={run.rebound} />
        <Metric label="held" value={run.held} />
        <Metric label="orphaned" value={run.orphaned} tone={run.orphaned > 0 ? "warn" : undefined} />
        <Metric label="failures" value={run.failures.length} tone={run.failures.length ? "bad" : undefined} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
        <Metric label="declared" value={`${fmtNum(zone.declaredSqft, 0)} sf`} />
        <Metric label="domain" value={`${fmtNum(run.domainSqft, 1)} sf`} />
        <Metric label="claimed wall" value={`${fmtNum(run.claimedWallSqft, 2)} sf`} />
        <Metric label="excluded residue" value={`${fmtNum(run.excludedResidueSqft, 1)} sf`} />
        <Metric label="rooms" value={`${fmtNum(run.totalSqft, 1)} sf`} />
        <Metric label="held residue" value={`${fmtNum(residueSqft, 1)} sf`} />
        <Metric
          label="closure"
          value={`${fmtNum(closure, 4)} sf`}
          tone={Math.abs(closure) > 0.01 ? "bad" : undefined}
        />
      </div>
      <p className="tele mt-1 truncate text-muted-foreground" title={run.profile}>
        profile: {run.profile}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn" | "bad";
}) {
  return (
    <span className="tele whitespace-nowrap text-muted-foreground">
      {label}{" "}
      <span
        className={cn(
          "text-foreground",
          tone === "warn" && "text-cat-clay",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * A vanished tag alongside an appeared one is a QUESTION, never a guess: did the engineer rename
 * a System, or is this a new one? Both answers are one click, and both write to the registry.
 */
function ReconcileQuestions({
  registry,
  disabled,
  onRename,
  onNew,
}: {
  registry: RegistryState;
  disabled: boolean;
  onRename: (fromGuid: string, toTag: string) => void;
  onNew: (tag: string) => void;
}) {
  return (
    <div className="space-y-1 rounded-[var(--radius)] border border-cat-clay/35 bg-cat-clay/5 p-2">
      <p className="section-label text-cat-clay">registry questions</p>
      {registry.renameCandidates.map((c) => (
        <div key={`${c.fromGuid}:${c.toTag}`} className="flex flex-wrap items-center gap-1.5">
          <span className="tele">
            <span className="text-foreground">{c.fromTag}</span> vanished ·{" "}
            <span className="text-foreground">{c.toTag}</span> appeared
          </span>
          <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onRename(c.fromGuid, c.toTag)}>
            rename {c.fromTag} → {c.toTag}
          </Button>
          <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onNew(c.toTag)}>
            {c.toTag} is a new System
          </Button>
        </div>
      ))}
      {registry.renameCandidates.length === 0 && (
        <p className="tele text-muted-foreground">
          appeared: {registry.appeared.join(", ") || "none"} · vanished:{" "}
          {registry.vanished.map((v) => v.tag).join(", ") || "none"} — too many to pair one by one;
          the lists are the report.
        </p>
      )}
    </div>
  );
}
