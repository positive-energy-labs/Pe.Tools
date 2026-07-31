import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, FolderOpen, Loader2, Save } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { SidePane } from "#/components/ui/side-pane";
import { rhvacAssemblies, rhvacOpen, rhvacSave, rhvacTakeoff } from "#/host/rhvac";
import { deriveAssemblyCatalog } from "#/rhvac/assemblies";
import { fmtNum } from "#/rhvac/cells";
import { useRhvacEditor, type RhvacEditor } from "#/rhvac/editor";
import { loadFixtureExtract, loadFixtureTakeoff } from "#/rhvac/fixture";
import { PlanPane } from "#/rhvac/plan-pane";
import { RoomDetail } from "#/rhvac/room-detail";
import { RoomsGrid } from "#/rhvac/rooms-grid";
import type {
  RhvacAssemblyCatalog,
  RhvacExtract,
  RhvacRoom,
  RhvacTakeoffData,
} from "#/rhvac/types";
import { cn } from "#/lib/utils";

/**
 * /rhvac — editor for Elite RHVAC .r10 Manual J projects. Opens a shared-drive
 * file via the `rhvac.open` host op (wave 2), edits rooms + envelope in a
 * dense grid, and saves through `rhvac.save` to a NEW file next to the source
 * (the original is never overwritten). Calculated loads are display-only and
 * go stale on any edit — only Preview Loads inside RHVAC recomputes them.
 * A project-a fixture makes the whole surface workable before the ops land.
 */
export const Route = createFileRoute("/rhvac")({
  component: RhvacRoute,
});

const outputPathFor = (sourcePath: string) => sourcePath.replace(/\.r10$/i, "") + ".pea.r10";

function RhvacRoute() {
  const editor = useRhvacEditor();
  const [pathInput, setPathInput] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<RhvacAssemblyCatalog | null>(null);
  const [takeoff, setTakeoff] = useState<RhvacTakeoffData | null>(null);
  const [takeoffError, setTakeoffError] = useState<string | null>(null);
  /** Original room number → identifier, frozen at load (room-map matches by original number). */
  const [identByOrigNumber, setIdentByOrigNumber] = useState<Map<number, number>>(new Map());

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);

  const acceptExtract = (extract: RhvacExtract, sourcePath: string) => {
    editor.load(extract, sourcePath);
    setIdentByOrigNumber(new Map(extract.rooms.map((r) => [r.number, r.identifier])));
    setSelectedIds(new Set());
    setFocusedId(null);
  };

  const openFromHost = async () => {
    const path = pathInput.trim();
    if (!path) return;
    setOpening(true);
    setOpenError(null);
    try {
      const extract = await rhvacOpen(path);
      acceptExtract(extract, path);
      // Assemblies: prefer the op (reads the .r10 tables); fall back to what the extract uses.
      try {
        setCatalog(await rhvacAssemblies(path));
      } catch {
        setCatalog(deriveAssemblyCatalog(extract));
      }
      try {
        setTakeoff(await rhvacTakeoff({ path }));
        setTakeoffError(null);
      } catch (caught) {
        setTakeoff(null);
        setTakeoffError(caught instanceof Error ? caught.message : "rhvac.takeoff failed");
      }
    } catch (caught) {
      setOpenError(caught instanceof Error ? caught.message : "rhvac.open failed");
    } finally {
      setOpening(false);
    }
  };

  const openFixture = async () => {
    setOpening(true);
    setOpenError(null);
    try {
      const extract = await loadFixtureExtract();
      acceptExtract(extract, extract.sourceFile);
      setCatalog(deriveAssemblyCatalog(extract));
      try {
        setTakeoff(await loadFixtureTakeoff());
        setTakeoffError(null);
      } catch (caught) {
        setTakeoff(null);
        setTakeoffError(caught instanceof Error ? caught.message : "fixture takeoff failed");
      }
    } catch (caught) {
      setOpenError(caught instanceof Error ? caught.message : "fixture load failed");
    } finally {
      setOpening(false);
    }
  };

  const matchByCandidate = useMemo(() => {
    const map = new Map<string, number>();
    for (const match of takeoff?.roomMap.matches ?? []) {
      const identifier = identByOrigNumber.get(match.oracleNumber);
      if (identifier !== undefined) map.set(match.candidate, identifier);
    }
    return map;
  }, [takeoff, identByOrigNumber]);

  const skipReasonById = useMemo(() => {
    const map = new Map<number, string>();
    for (const skip of takeoff?.roomMap.skip ?? []) {
      const identifier = identByOrigNumber.get(skip.oracleNumber);
      if (identifier !== undefined) map.set(identifier, skip.reason);
    }
    return map;
  }, [takeoff, identByOrigNumber]);

  const onToggleSelect = useCallback((identifier: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(identifier)) next.delete(identifier);
      else next.add(identifier);
      return next;
    });
  }, []);

  const onPatchRoom = useCallback(
    (identifier: number, patch: Partial<RhvacRoom>) =>
      editor.updateRoom(identifier, (room) => ({ ...room, ...patch })),
    [editor.updateRoom],
  );

  const focusedRoom =
    focusedId === null ? null : (editor.rooms.find((r) => r.identifier === focusedId) ?? null);
  const dirtyCount = editor.pendingUpdates.length;
  const hasPending = dirtyCount > 0 || editor.deleted.size > 0;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 pb-2 pt-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="font-pe-display text-lg font-semibold tracking-tight">RHVAC</h1>
          {editor.doc && (
            <span
              className="tele max-w-96 truncate text-muted-foreground"
              title={editor.doc.sourcePath}
            >
              {editor.doc.sourcePath}
            </span>
          )}
        </div>
        {editor.doc && <BuildingTotals editor={editor} />}
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void openFromHost();
            }}
            placeholder="G:\…\project.r10"
            className="tele h-7 w-72"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={opening || pathInput.trim().length === 0}
            onClick={() => void openFromHost()}
          >
            {opening ? <Loader2 className="animate-spin" /> : <FolderOpen />}
            Open
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={opening}
            title="Load the project-a eval fixture (works without the rhvac.* host ops)"
            onClick={() => void openFixture()}
          >
            <FlaskConical />
            project-a fixture
          </Button>
        </div>
      </header>

      {openError && (
        <p className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {openError} — the rhvac.* host ops may not be wired yet; the project-a fixture works without
          them.
        </p>
      )}

      {editor.doc ? (
        <div className="flex min-h-0 flex-1">
          <RoomsGrid
            rooms={editor.rooms}
            systems={editor.doc.systems}
            dirtyIds={editor.dirtyIds}
            deleted={editor.deleted}
            selectedIds={selectedIds}
            focusedId={focusedId}
            loadsStale={editor.loadsStale}
            onToggleSelect={onToggleSelect}
            onSetSelection={setSelectedIds}
            onFocus={setFocusedId}
            onPatchRoom={onPatchRoom}
            onBulkAssign={editor.bulkAssign}
            onDelete={editor.deleteRooms}
            onUndelete={editor.undeleteRoom}
          />
          {focusedRoom && (
            <RoomDetail
              room={focusedRoom}
              system={editor.doc.systems.find((s) => s.number === focusedRoom.systemNumber)}
              catalog={catalog}
              loadsStale={editor.loadsStale}
              onMutate={(mutate) => editor.updateRoom(focusedRoom.identifier, mutate)}
              onClose={() => setFocusedId(null)}
            />
          )}
          <SidePane
            side="right"
            storageKey="rhvac:plan"
            minWidth={280}
            defaultWidth={440}
            header={<span className="section-label">Plan · takeoff polygons</span>}
          >
            <PlanPane
              takeoff={takeoff}
              takeoffError={takeoffError}
              rooms={editor.rooms}
              matchByCandidate={matchByCandidate}
              skipReasonById={skipReasonById}
              focusedId={focusedId}
              onPickRoom={setFocusedId}
            />
          </SidePane>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center">
          <div className="max-w-md text-center">
            <p className="text-sm text-foreground">Open an Elite RHVAC .r10 project</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Paste a shared-drive path above and Open (needs the rhvac.* host ops), or load the
              project-a fixture to work against real eval data today. Saving always writes a new
              file next to the source — the original .r10 is never overwritten.
            </p>
          </div>
        </div>
      )}

      {editor.doc && hasPending && <SaveBar editor={editor} />}
    </main>
  );
}

function BuildingTotals({ editor }: { editor: RhvacEditor }) {
  const building = editor.doc?.building;
  if (!building) return null;
  const Item = ({ label, value, unit }: { label: string; value: number; unit: string }) => (
    <span className="tele whitespace-nowrap text-muted-foreground">
      {label}{" "}
      <span className={cn("text-foreground", editor.loadsStale && "text-cat-clay opacity-80")}>
        {fmtNum(value, 0)}
      </span>{" "}
      {unit}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
      <Item label="bldg" value={building.areaSquareFeet} unit="sf" />
      <Item label="cool net" value={building.coolingLoadNetBtuh} unit="Btuh" />
      <Item label="cool rec" value={building.coolingLoadRecommendedBtuh} unit="Btuh" />
      <Item label="heat" value={building.heatingLoadBtuh} unit="Btuh" />
      <span
        className={cn(
          "tele-label rounded-[var(--radius)] border px-1.5 py-px",
          editor.loadsStale
            ? "border-cat-clay/40 bg-cat-clay/10 text-cat-clay"
            : "border-border text-muted-foreground",
        )}
        title="Loads are RHVAC calc outputs. Editing anything here makes them stale until you run Preview Loads in RHVAC."
      >
        {editor.loadsStale
          ? "loads stale — run Preview Loads in RHVAC"
          : "loads as of last RHVAC calc"}
      </span>
    </div>
  );
}

/**
 * Save bar — appears once anything is edited or deleted. Writes via rhvac.save
 * to an output path that defaults to `<source>.pea.r10`; saving to the source
 * path itself is refused so the original file always survives.
 */
function SaveBar({ editor }: { editor: RhvacEditor }) {
  const sourcePath = editor.doc?.sourcePath ?? "";
  const [outputPath, setOutputPath] = useState(() => outputPathFor(sourcePath));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const badRefRooms = editor.pendingUpdates.filter((room) => {
    const n = room.walls.length;
    return (
      room.glass.some((g) => g.wallReference < 1 || g.wallReference > n) ||
      room.doors.some((d) => d.wallReference < 1 || d.wallReference > n)
    );
  });
  const samePath = outputPath.trim().toLowerCase() === sourcePath.trim().toLowerCase();
  const blocked = badRefRooms.length > 0 || samePath || outputPath.trim().length === 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await rhvacSave({
        sourcePath,
        outputPath: outputPath.trim(),
        edits: {
          updates: editor.pendingUpdates,
          deletes: [...editor.deleted],
        },
      });
      editor.markSaved();
      setNote(
        `Saved ${result.updated} edited / ${result.deleted} deleted → ${result.outputPath}. Loads are still as of the last RHVAC calc — run Preview Loads in RHVAC.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "rhvac.save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="shrink-0 border-t border-border bg-card px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tele">
          <span className="text-cat-clay">{editor.pendingUpdates.length} edited</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-destructive">{editor.deleted.size} deleted</span>
        </span>
        <span className="tele-label ml-2 text-muted-foreground">save to</span>
        <Input
          value={outputPath}
          onChange={(e) => setOutputPath(e.target.value)}
          className="tele h-7 min-w-64 flex-1"
          placeholder={outputPathFor(sourcePath)}
        />
        <Button size="sm" disabled={busy || blocked} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          {busy ? "Saving…" : "Save copy"}
        </Button>
        <span className="tele text-muted-foreground">original is never overwritten</span>
      </div>
      {samePath && (
        <p className="mt-1 text-xs text-destructive">
          Output path equals the source path — pick a different name; the original .r10 stays
          untouched.
        </p>
      )}
      {badRefRooms.length > 0 && (
        <p className="mt-1 text-xs text-destructive">
          {badRefRooms.length} edited room{badRefRooms.length === 1 ? " has" : "s have"} glass/doors
          pointing at a missing wall ordinal (#{badRefRooms.map((r) => r.number).join(", #")}) — fix
          before saving.
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs text-destructive">
          {error} — rhvac.save may not be wired yet; edits stay staged in this session.
        </p>
      )}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </footer>
  );
}
