// THROWAWAY — /runs feedback-loop round 1 (proto). The three export verbs, all REAL:
//   chat  — write per-item PNGs + manifest.json to <pool>/_exports/<stamp>/, then copy a
//           COMPACT TEXT BLOCK (ids, flags, notes, absolute PNG paths) to the clipboard.
//           Text-with-paths is the lingua franca: agent TUIs can't paste images.
//   sheet — one stitched contact-sheet PNG to the clipboard as an image (GUI chats), and the
//           same files written for the record.
//   snip  — same write, then the server opens the first PNG in Windows Snipping Tool
//           (ms-screensketch:edit — verified live on this machine) for freehand annotation.
// Compositing is client-side (composite.ts); the server only writes files and launches the tool.
import { canvasToBlob, canvasToPngBase64, compositeItem, stitchSheet } from "./composite";
import { type ExportRecord, fb, flagLabel, type StagedItem } from "./staging";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slug(item: StagedItem, index: number): string {
  const zone = item.zone.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${String(index + 1).padStart(2, "0")}-${zone}`;
}

const shortRun = (id: string | null) => (id ? id : "(none)");

type ServerResult = {
  dir: string;
  files: { name: string; path: string }[];
  manifestPath: string;
  opened: string | null;
};

/** The compact clipboard block for agent TUIs. Per item: zone, A/B run ids, flagged element
 * ids, the note, the absolute PNG path. Agents read the PNGs from the paths. */
export function buildTextBlock(
  items: StagedItem[],
  server: ServerResult,
  pool: string | null,
): string {
  const lines: string[] = [];
  lines.push(`takeoff /runs feedback — ${items.length} staged item${items.length === 1 ? "" : "s"}`);
  if (pool) lines.push(`pool: ${pool}`);
  lines.push("");
  items.forEach((item, i) => {
    const png = server.files.find((f) => f.name === `${slug(item, i)}.png`)?.path ?? "(missing)";
    lines.push(`[${i + 1}] ${item.zone} · A=${shortRun(item.runA)} · B=${item.runB}`);
    lines.push(`    flags: ${item.flags.length > 0 ? item.flags.map(flagLabel).join(", ") : "none"}`);
    if (item.note.trim()) lines.push(`    note: ${item.note.trim()}`);
    lines.push(`    png: ${png}`);
    lines.push("");
  });
  lines.push(`manifest: ${server.manifestPath}`);
  return lines.join("\n");
}

function manifestFor(items: StagedItem[], pool: string | null, verb: string) {
  const sideStats = (z: StagedItem["a"]) =>
    z
      ? {
          verdict: z.triage.verdict,
          reason: z.triage.reason,
          acceptedRooms: z.AcceptedRooms,
          oracleRooms: z.OracleRooms,
          heldRooms: z.HeldRooms,
          acceptedSqft: Math.round(z.AcceptedSqft * 10) / 10,
          heldSqft: Math.round(z.HeldSqft * 10) / 10,
          inkBackedEdgeFraction: Math.round(z.InkBackedEdgeFraction * 1000) / 1000,
        }
      : null;
  return {
    surface: "/runs feedback-loop round 1 (proto)",
    verb,
    generatedUtc: new Date().toISOString(),
    pool,
    items: items.map((item, i) => ({
      index: i + 1,
      zone: item.zone,
      level: item.level,
      runA: item.runA,
      runB: item.runB,
      // The flags ARE data: element ids from the run package (rooms/residues in B's TSV).
      flags: item.flags,
      note: item.note.trim() || null,
      a: sideStats(item.a),
      b: sideStats(item.b),
      png: null as string | null, // server fills the absolute path
    })),
  };
}

export async function runExport(
  verb: ExportRecord["verb"],
  items: StagedItem[],
  pool: string | null,
): Promise<void> {
  if (items.length === 0 || fb.get().exporting) return;
  fb.exportStarted(verb);
  try {
    const composites: HTMLCanvasElement[] = [];
    for (const item of items) composites.push(await compositeItem(item));

    const sheetCanvas =
      verb === "sheet"
        ? stitchSheet(composites, `takeoff /runs feedback — ${items.length} staged — ${new Date().toISOString()}`)
        : null;
    // The clipboard image blob is made BEFORE the POST so the write stays inside the user
    // gesture's transient activation.
    const sheetBlob = sheetCanvas ? await canvasToBlob(sheetCanvas) : null;

    const payload = {
      stamp: stamp(),
      openSnip: verb === "snip",
      items: await Promise.all(
        items.map(async (item, i) => ({
          fileName: `${slug(item, i)}.png`,
          pngBase64: await canvasToPngBase64(composites[i]!),
        })),
      ),
      sheetBase64: sheetCanvas ? await canvasToPngBase64(sheetCanvas) : null,
      manifest: manifestFor(items, pool, verb),
    };

    const res = await fetch("/api/runs-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`export server: ${res.status} ${await res.text()}`);
    const server = (await res.json()) as ServerResult;

    // Clipboard AFTER the write: a clipboard denial must not un-happen the export — the files
    // are on disk. Browser clipboard first; on denial (no user activation, unfocused pane) fall
    // back to the OS clipboard through the export server (Set-Clipboard — REAL, and it drops
    // clip.txt next to the PNGs as the export's own record).
    let text: string | null = null;
    let warning: string | null = null;
    const osClipboard = async (req: { text?: string; imagePath?: string; dir?: string }) => {
      const r = await fetch("/api/runs-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clipboard: req }),
      });
      if (!r.ok) throw new Error(`os clipboard: ${r.status} ${await r.text()}`);
    };
    try {
      if (verb === "chat") {
        text = buildTextBlock(items, server, pool);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          await osClipboard({ text, dir: server.dir });
        }
      } else if (verb === "sheet" && sheetBlob) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": sheetBlob })]);
        } catch {
          const sheetPath = server.files.find((f) => f.name === "sheet.png")?.path;
          if (!sheetPath) throw new Error("sheet.png missing from the export");
          await osClipboard({ imagePath: sheetPath });
        }
      }
    } catch (err) {
      warning = `files written, but the clipboard write failed (${String(err)})${verb === "chat" ? " — copy from the block below" : ""}`;
    }

    fb.exportDone({
      verb,
      dir: server.dir,
      files: server.files.map((f) => f.path),
      manifestPath: server.manifestPath,
      text,
      opened: server.opened,
      warning,
      atUtc: new Date().toISOString(),
    });
  } catch (err) {
    fb.exportFailed(String(err));
  }
}
