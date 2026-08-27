// The /runs feedback export verbs, all REAL:
//   chat  — write per-item PNGs + manifest.json + clip.txt to <pool>/_exports/<stamp>/, and
//           put the compact text block (ids, flags, notes, absolute PNG paths, the set's own
//           ?set= URL) on the clipboard. Text-with-paths is the lingua franca: agent TUIs
//           can't paste images.
//   sheet — one stitched contact-sheet PNG on the clipboard as an image (GUI chats); same
//           files + clip.txt written for the record.
//   snip  — same write, then the server opens the first PNG in Windows Snipping Tool
//           (ms-screensketch:edit — verified live) for freehand annotation.
//
// Clipboard order (round-2 ruling): the server-side OS clipboard (Set-Clipboard / SetImage)
// is the PRIMARY copy path — it needs no user-activation and works from embedded panes —
// navigator.clipboard is the fallback. clip.txt is ALWAYS written, every verb: the export
// dir carries its own paste-ready record.
//
// Persistence law: the manifest is the ONLY persistence. Re-export mints a NEW stamp (the
// server suffixes on collision, never overwrites); each export's clip block carries its own
// ?set= URL so any chat message that quotes it can reopen the staging.
import { canvasToBlob, canvasToPngBase64, compositeItem, stitchSheet } from "./composite";
import { type ExportRecord, fb, flagLabel, type StagedItem } from "./staging";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slug(item: StagedItem, index: number): string {
  const zone = item.zone
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${String(index + 1).padStart(2, "0")}-${zone}`;
}

const shortRun = (id: string | null) => id ?? "(none)";

type ServerResult = {
  dir: string;
  stamp: string;
  files: { name: string; path: string }[];
  manifestPath: string;
  clipPath: string;
  clipText: string;
  setUrl: string;
  clipboard: { ok: boolean; detail: string } | null;
  opened: string | null;
};

/** The clip block TEMPLATE. `{{DIR}}/<file>` and `{{SET}}` are resolved by the export server
 * (it owns the final stamp — collisions get suffixed — and the absolute paths). */
function buildClipTemplate(items: StagedItem[], pool: string | null): string {
  const lines: string[] = [];
  lines.push(
    `takeoff /runs feedback — ${items.length} staged item${items.length === 1 ? "" : "s"}`,
  );
  lines.push(`set: {{SET}}`);
  if (pool) lines.push(`pool: ${pool}`);
  lines.push("");
  items.forEach((item, i) => {
    lines.push(`[${i + 1}] ${item.zone} · A=${shortRun(item.runA)} · B=${item.runB}`);
    lines.push(
      `    flags: ${item.flags.length > 0 ? item.flags.map(flagLabel).join(", ") : "none"}`,
    );
    if (item.note.trim()) lines.push(`    note: ${item.note.trim()}`);
    lines.push(`    png: {{DIR}}/${slug(item, i)}.png`);
    lines.push("");
  });
  lines.push(`manifest: {{DIR}}/manifest.json`);
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
    surface: "/runs feedback",
    schemaNote:
      "takeoff-runs feedback export manifest v2. This file is the ONLY persistence of a staged " +
      "set. Rehydrate: open <origin>/runs?set=<stamp> — the page reloads `items` into the " +
      "staging tray, editable; re-export mints a NEW stamp, never overwrites this one. Per " +
      "item: zone (positional name, SHIMS #2), level, runA/runB = the PINNED A/B pair " +
      "(runA null = staged without a baseline), flags = element ids judged on B " +
      "('room:R06' | 'residue:R03'), note = the one free-text verdict, stagedAt = epoch ms, " +
      "a/b = stat summaries at stage time (report.json in the run package stays the source of " +
      "truth), png = the composited panel image, absolute path, server-filled.",
    verb,
    stamp: null as string | null, // server fills the final (collision-suffixed) stamp
    setUrl: null as string | null, // server fills <origin>/runs?set=<stamp>
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
      stagedAt: item.stagedAt,
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
        ? stitchSheet(
            composites,
            `takeoff /runs feedback — ${items.length} staged — ${new Date().toISOString()}`,
          )
        : null;
    // Blob made up-front so a navigator fallback still sits inside the user gesture's
    // transient activation window when the server clipboard refuses.
    const sheetBlob = sheetCanvas ? await canvasToBlob(sheetCanvas) : null;

    const payload = {
      stamp: stamp(),
      origin: window.location.origin,
      openSnip: verb === "snip",
      // OS clipboard is the PRIMARY copy path (round-2 ruling); clip.txt always written.
      clipboardVerb: verb === "chat" ? "text" : verb === "sheet" ? "image" : null,
      clipTemplate: buildClipTemplate(items, pool),
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

    // Copy result: OS clipboard already attempted server-side. Fall back to the browser
    // clipboard only if that refused — and never let a copy failure un-happen the export.
    let copiedVia: ExportRecord["copiedVia"] = server.clipboard?.ok ? "os" : null;
    let warning: string | null = null;
    if (payload.clipboardVerb && !server.clipboard?.ok) {
      try {
        if (payload.clipboardVerb === "text") {
          await navigator.clipboard.writeText(server.clipText);
        } else if (sheetBlob) {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": sheetBlob })]);
        }
        copiedVia = "browser";
        warning = `OS clipboard refused (${server.clipboard?.detail ?? "?"}) — copied via the browser instead`;
      } catch (err) {
        warning = `files + clip.txt written, but both clipboards refused (os: ${server.clipboard?.detail ?? "?"}; browser: ${String(err)})${verb === "chat" ? " — copy from the block below" : ""}`;
      }
    }

    fb.exportDone({
      verb,
      dir: server.dir,
      stamp: server.stamp,
      files: server.files.map((f) => f.path),
      manifestPath: server.manifestPath,
      setUrl: server.setUrl,
      text: server.clipText,
      copiedVia,
      opened: server.opened,
      warning,
      atUtc: new Date().toISOString(),
    });
  } catch (err) {
    fb.exportFailed(String(err));
  }
}
