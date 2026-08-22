// Client-side PNG compositing for the /runs feedback export verbs: each staged item becomes
// one PNG — canvas underlay (the run's own rasters, muted per the underlay law) + the
// serialized SVG decision overlay (flags in the alarm family) + a caption strip carrying the
// DATA (zone, run ids, key stats, flagged element ids, the note). The caption makes each PNG
// self-describing so an agent reading it off disk needs no manifest in-context.
//
// Palette is shared with the on-screen surface via ../palette (round-1 friction #1 resolved —
// the export can no longer drift from the screen). Known residual duplication: this painter
// re-implements ZonePanel's layer order instead of calling a world-owned panel painter; still
// ledgered as promotion debt in CLEANROOM's round-1 friction list.
import {
  alarmColor,
  CLOSE_M,
  HELD_FILL,
  HELD_STROKE,
  INK_M,
  PAPER,
  roomTone,
  SEAL_M,
  VOID_FILL,
  VOID_STROKE,
  ZONE_STROKE,
} from "../palette";
import {
  loadRaster,
  loadReplaySeedInk,
  loadZoneGeometry,
  paintRaster,
  ringPath,
  type ZoneGeometry,
  type ZoneRecord,
  type ZoneViewport,
  zoneViewport,
} from "../world";

import { flagLabel, type StagedItem } from "./staging";

const TEXT = "#44403c";
const MUTED = "#78716c";

const PANEL_W = 640;
const PANEL_H = 460;
const GAP = 12;
const FONT = "12px Consolas, monospace";
const LINE_H = 18;

function svgEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Serialize the decision overlay for one panel — same geometry the on-screen ZonePanel draws,
 * flags rendered in the alarm family. */
function overlaySvg(
  vp: ZoneViewport,
  zone: ZoneRecord,
  geom: ZoneGeometry,
  flags: Set<string>,
): string {
  const alarm = alarmColor();
  const parts: string[] = [];
  for (const room of geom.rooms) {
    const rings = geom.polys.get(room.id);
    if (!rings) continue;
    const flagged = flags.has(`room:${room.id}`);
    // Unflagged rooms wear their PERSISTED disposition, same as the screen — an unknown room is
    // a dashed neutral, never the accepted blue (SHIMS.md #3 close).
    const unknown = room.disposition === null;
    const stroke = flagged ? alarm : roomTone(room.disposition).stroke;
    const dash = !flagged && unknown ? ' stroke-dasharray="2 2"' : "";
    parts.push(
      `<path d="${ringPath(
        vp,
        rings.map((r) => r.points),
      )}" fill="${flagged ? alarm : "none"}" fill-opacity="${flagged ? 0.18 : 0}" stroke="${stroke}" stroke-width="${flagged ? 2.5 : unknown ? 1.25 : 1.75}"${dash}/>`,
    );
    if (flagged) {
      // Label the flagged element on the pixels too — the id in the manifest is the data,
      // the label keeps the PNG readable standalone.
      const first = rings[0]?.points[0];
      if (first) {
        const [x, y] = [(first[0] - vp.minX) * vp.pxPerFt, (vp.maxY - first[1]) * vp.pxPerFt];
        parts.push(
          `<text x="${(x + 4).toFixed(1)}" y="${(y + 14).toFixed(1)}" fill="${alarm}" font-family="monospace" font-size="12" font-weight="bold">⚑ ${svgEscape(room.id)}</text>`,
        );
      }
    }
  }
  for (const res of geom.residues) {
    const flagged = flags.has(`residue:${res.id}`);
    const held = res.reason === "rejected";
    parts.push(
      `<path d="${ringPath(vp, res.loops)}" fill="${flagged ? alarm : "none"}" fill-opacity="${flagged ? 0.14 : 0}" stroke="${flagged ? alarm : held ? HELD_STROKE : VOID_STROKE}" stroke-width="${flagged ? 2.5 : held ? 1.6 : 0.75}"${held && !flagged ? ' stroke-dasharray="4 3"' : ""}/>`,
    );
    if (flagged) {
      const first = res.loops[0]?.[0];
      if (first) {
        const [x, y] = [(first[0] - vp.minX) * vp.pxPerFt, (vp.maxY - first[1]) * vp.pxPerFt];
        parts.push(
          `<text x="${(x + 4).toFixed(1)}" y="${(y + 14).toFixed(1)}" fill="${alarm}" font-family="monospace" font-size="12" font-weight="bold">⚑ residue ${svgEscape(res.id)}</text>`,
        );
      }
    }
  }
  parts.push(
    `<path d="${ringPath(vp, zone.ZoneLoops as [number, number][][])}" fill="none" stroke="${ZONE_STROKE}" stroke-width="1.5" opacity="0.9"${zone.triage.verdict === "hold" ? ' stroke-dasharray="7 4"' : ""}/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vp.widthPx}" height="${vp.heightPx}" viewBox="0 0 ${vp.widthPx} ${vp.heightPx}">${parts.join("")}</svg>`;
}

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg overlay rasterization failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** One panel tile: PANEL_W×PANEL_H, paper ground, underlay per the paint-order law (decision
 * fills under, invented closures translucent, received ink LAST), then the serialized SVG
 * overlay. */
async function paintPanelTile(
  runId: string,
  zone: ZoneRecord,
  flags: Set<string>,
): Promise<HTMLCanvasElement> {
  const pad = 4;
  const wFt = zone.MaxX - zone.MinX + pad * 2;
  const hFt = zone.MaxY - zone.MinY + pad * 2;
  const pxPerFt = Math.min(8, Math.max(0.4, Math.min(PANEL_W / wFt, PANEL_H / hFt)));
  const vp = zoneViewport(zone, pxPerFt, pad);

  const tile = document.createElement("canvas");
  tile.width = PANEL_W;
  tile.height = PANEL_H;
  const tctx = tile.getContext("2d");
  if (!tctx) throw new Error("2d context unavailable");
  tctx.fillStyle = PAPER;
  tctx.fillRect(0, 0, PANEL_W, PANEL_H);

  const inner = document.createElement("canvas");
  inner.width = vp.widthPx;
  inner.height = vp.heightPx;
  const ctx = inner.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, vp.widthPx, vp.heightPx);

  const geom = await loadZoneGeometry(runId, zone.Tsv).catch(
    (): ZoneGeometry => ({ rooms: [], polys: new Map(), residues: [] }),
  );

  // Decision fills under the evidence (a decision may never obscure ink).
  for (const room of geom.rooms) {
    const rings = geom.polys.get(room.id);
    if (!rings) continue;
    ctx.fillStyle = roomTone(room.disposition).fill;
    ctx.fill(
      new Path2D(
        ringPath(
          vp,
          rings.map((r) => r.points),
        ),
      ),
      "evenodd",
    );
  }
  for (const res of geom.residues) {
    ctx.fillStyle = res.reason === "rejected" ? HELD_FILL : VOID_FILL;
    ctx.fill(new Path2D(ringPath(vp, res.loops)), "evenodd");
  }
  try {
    const [ink, seals, close] = await Promise.all([
      loadReplaySeedInk(runId, zone.Ink).catch(() => null),
      zone.Seals ? loadRaster(runId, zone.Seals).catch(() => null) : null,
      zone.Close ? loadRaster(runId, zone.Close).catch(() => null) : null,
    ]);
    if (close) paintRaster(ctx, close, vp, CLOSE_M);
    if (seals) paintRaster(ctx, seals, vp, SEAL_M);
    if (ink) paintRaster(ctx, ink, vp, INK_M);
  } catch {
    // evidence layer failed — decisions stay visible
  }

  const overlay = await svgToImage(overlaySvg(vp, zone, geom, flags));
  ctx.drawImage(overlay, 0, 0);

  tctx.drawImage(inner, (PANEL_W - vp.widthPx) / 2, (PANEL_H - vp.heightPx) / 2);
  return tile;
}

function missingTile(label: string): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = PANEL_W;
  tile.height = PANEL_H;
  const ctx = tile.getContext("2d")!;
  ctx.fillStyle = "#f5f5f4";
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  ctx.fillStyle = MUTED;
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.fillText(label, PANEL_W / 2, PANEL_H / 2);
  return tile;
}

const fmtSqft = (v: number) => `${Math.round(v).toLocaleString()} sf`;

function captionLines(item: StagedItem): { text: string; tone: "text" | "muted" | "alarm" }[] {
  const { a, b } = item;
  const lines: { text: string; tone: "text" | "muted" | "alarm" }[] = [];
  lines.push({ text: `${item.zone} — A ${item.runA ?? "(none)"} | B ${item.runB}`, tone: "text" });
  if (b) {
    const delta = a
      ? ` · Δ ${Math.round(b.AcceptedSqft - a.AcceptedSqft) >= 0 ? "+" : ""}${Math.round(b.AcceptedSqft - a.AcceptedSqft)} sf vs A`
      : "";
    lines.push({
      text: `B: ${b.triage.verdict} (${b.triage.reason}) · ${b.AcceptedRooms}/${b.OracleRooms}r · ${fmtSqft(b.AcceptedSqft)} accepted · ${fmtSqft(b.HeldSqft)} held · ink-backed ${Math.round(b.InkBackedEdgeFraction * 100)}%${delta}`,
      tone: "muted",
    });
  }
  if (a) {
    lines.push({
      text: `A: ${a.triage.verdict} (${a.triage.reason}) · ${a.AcceptedRooms}/${a.OracleRooms}r · ${fmtSqft(a.AcceptedSqft)} accepted · ${fmtSqft(a.HeldSqft)} held`,
      tone: "muted",
    });
  }
  lines.push({
    text:
      item.flags.length > 0
        ? `⚑ flags (B): ${item.flags.map(flagLabel).join(", ")}`
        : "flags: none",
    tone: item.flags.length > 0 ? "alarm" : "muted",
  });
  if (item.note.trim()) lines.push({ text: `note: ${item.note.trim()}`, tone: "text" });
  return lines;
}

/** One staged item → one composited canvas: [A|B] panels (or a single B panel spanning) over
 * the caption strip. Flags draw on the B side — the flagged ids came from B's geometry. */
export async function compositeItem(item: StagedItem): Promise<HTMLCanvasElement> {
  const flags = new Set(item.flags);
  const comparing = item.runA !== null;
  const tiles: HTMLCanvasElement[] = [];
  if (comparing) {
    tiles.push(
      item.a && item.runA
        ? await paintPanelTile(item.runA, item.a, new Set())
        : missingTile("not in baseline"),
    );
  }
  tiles.push(
    item.b ? await paintPanelTile(item.runB, item.b, flags) : missingTile("not in current"),
  );

  const lines = captionLines(item);
  const captionH = lines.length * LINE_H + 14;
  const w = tiles.length * PANEL_W + (tiles.length - 1) * GAP + 2 * GAP;
  const h = PANEL_H + captionH + 2 * GAP + 20;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  ctx.font = FONT;
  ctx.textBaseline = "top";
  tiles.forEach((tile, i) => {
    const x = GAP + i * (PANEL_W + GAP);
    ctx.fillStyle = MUTED;
    ctx.fillText(
      comparing ? (i === 0 ? "A · baseline" : "B · current") : "B · current",
      x,
      GAP - 2,
    );
    ctx.drawImage(tile, x, GAP + 14);
    ctx.strokeStyle = "#e7e5e4";
    ctx.strokeRect(x + 0.5, GAP + 14.5, PANEL_W - 1, PANEL_H - 1);
  });

  const alarm = alarmColor();
  lines.forEach((line, i) => {
    ctx.fillStyle = line.tone === "alarm" ? alarm : line.tone === "muted" ? MUTED : TEXT;
    ctx.fillText(line.text, GAP, GAP + 14 + PANEL_H + 10 + i * LINE_H, w - 2 * GAP);
  });
  return out;
}

/** All staged items → one stitched contact sheet (the GUI-chat verb). */
export function stitchSheet(canvases: HTMLCanvasElement[], header: string): HTMLCanvasElement {
  const w = Math.max(...canvases.map((c) => c.width));
  const h = canvases.reduce((s, c) => s + c.height, 0) + (canvases.length - 1) * GAP + 34;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = TEXT;
  ctx.fillText(header, GAP, 10, w - 2 * GAP);
  let y = 34;
  for (const c of canvases) {
    ctx.drawImage(c, 0, y);
    y += c.height + GAP;
  }
  return out;
}

export function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("toBlob failed"));
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",", 2)[1]!);
      reader.onerror = () => reject(new Error("blob read failed"));
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}
