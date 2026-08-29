import {
  candidateTone,
  CLOSE_M,
  HELD_HATCH,
  INK_M,
  LABEL,
  LABEL_SIZE,
  PLAN_LAW,
  RESIDUE_TREATMENT,
  type ResidueKind,
  SEAL_DOOR,
  SEAL_RUN,
  ZONE_STROKE,
  ZONE_WIDTH,
} from "../palette";
import { dash, token } from "../../lib/token";
import {
  loadPlan,
  loadRaster,
  loadReplaySeedInk,
  loadSealClasses,
  loadZoneGeometry,
  paintClassRaster,
  paintPlan,
  paintRaster,
  ringPath,
  type ZoneGeometry,
  type ZoneRecord,
  type ZoneViewport,
  zoneViewport,
} from "../world";

import { flagLabel, type StagedItem } from "./staging";

const TEXT = token("ink");
const MUTED = token("ink-2");

const PANEL_W = 1024;
const PANEL_H = 768;
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

function overlaySvg(
  vp: ZoneViewport,
  zone: ZoneRecord,
  geom: ZoneGeometry,
  flags: Set<string>,
): string {
  const alarm = token("alarm");
  const defs: string[] = [];
  const parts: string[] = [];
  const hatch = (
    id: string,
    treatment: { angleDeg: number; color: string; spacingPx: number; widthPx: number },
  ) => {
    defs.push(
      `<pattern id="${id}" width="${treatment.spacingPx}" height="${treatment.spacingPx}" patternUnits="userSpaceOnUse" patternTransform="rotate(${treatment.angleDeg})"><line y2="${treatment.spacingPx}" stroke="${treatment.color}" stroke-width="${treatment.widthPx}"/></pattern>`,
    );
  };
  for (const room of geom.rooms) {
    const rings = geom.polys.get(room.id);
    if (!rings) continue;
    const flagged = flags.has(`room:${room.id}`);
    // a dashed neutral, never the accepted blue (SHIMS.md #3 close).
    const tone = candidateTone(zone.Zone, room.id);
    const residue = room.disposition === null ? RESIDUE_TREATMENT.void : null;
    const d = ringPath(
      vp,
      rings.map((r) => r.points),
    );
    parts.push(
      `<path d="${d}" fill="${residue ? "none" : tone.fill}" stroke="${flagged ? alarm : (residue?.outline.color ?? "none")}" stroke-width="${flagged ? 2.5 : (residue?.outline.widthPx ?? 0)}"/>`,
    );
    if (residue) {
      const id = `void-room-${room.id}`;
      hatch(id, residue.hatch);
      parts.push(`<path d="${d}" fill="url(#${id})"/>`);
    }
    if (room.disposition === "held") {
      const id = `held-room-${room.id}`;
      hatch(id, { ...HELD_HATCH, color: tone.dark });
      parts.push(`<path d="${d}" fill="url(#${id})"/>`);
    }
    if (room.disposition) {
      parts.push(
        `<text x="${(room.lx - vp.minX) * vp.pxPerFt}" y="${(vp.maxY - room.ly) * vp.pxPerFt}" fill="${LABEL}" font-family="var(--font-mono)" font-size="${LABEL_SIZE}" text-anchor="middle">${room.disposition === "held" ? "H" : "A"} ${svgEscape(room.id)}</text>`,
      );
    }
    if (flagged) {
      const first = rings[0]?.points[0];
      if (first) {
        const [x, y] = [(first[0] - vp.minX) * vp.pxPerFt, (vp.maxY - first[1]) * vp.pxPerFt];
        parts.push(
          `<text x="${(x + 4).toFixed(1)}" y="${(y + 14).toFixed(1)}" fill="${alarm}" font-family="var(--font-mono)" font-size="var(--type-value-size)" font-weight="var(--weight-bold)">⚑ ${svgEscape(room.id)}</text>`,
        );
      }
    }
  }
  for (const res of geom.residues) {
    const flagged = flags.has(`residue:${res.id}`);
    const held = res.reason === "rejected";
    const kind: ResidueKind = res.reason === "excluded" ? "excluded" : "void";
    const residue = held ? null : RESIDUE_TREATMENT[kind];
    const tone = candidateTone(zone.Zone, res.id);
    const d = ringPath(vp, res.loops);
    parts.push(
      `<path d="${d}" fill="${held ? tone.fill : "none"}" stroke="${flagged ? alarm : (residue?.outline.color ?? "none")}" stroke-width="${flagged ? 2.5 : (residue?.outline.widthPx ?? 0)}"/>`,
    );
    if (residue) {
      const id = `${kind}-residue-${res.id}`;
      hatch(id, residue.hatch);
      parts.push(`<path d="${d}" fill="url(#${id})"/>`);
    }
    if (held) {
      const id = `held-residue-${res.id}`;
      hatch(id, { ...HELD_HATCH, color: tone.dark });
      parts.push(`<path d="${d}" fill="url(#${id})"/>`);
      const point = res.loops[0]?.[0];
      if (point) {
        parts.push(
          `<text x="${(point[0] - vp.minX) * vp.pxPerFt}" y="${(vp.maxY - point[1]) * vp.pxPerFt}" fill="${LABEL}" font-family="var(--font-mono)" font-size="${LABEL_SIZE}">H ${svgEscape(res.id)}</text>`,
        );
      }
    }
    if (flagged) {
      const first = res.loops[0]?.[0];
      if (first) {
        const [x, y] = [(first[0] - vp.minX) * vp.pxPerFt, (vp.maxY - first[1]) * vp.pxPerFt];
        parts.push(
          `<text x="${(x + 4).toFixed(1)}" y="${(y + 14).toFixed(1)}" fill="${alarm}" font-family="var(--font-mono)" font-size="var(--type-value-size)" font-weight="var(--weight-bold)">⚑ residue ${svgEscape(res.id)}</text>`,
        );
      }
    }
  }
  parts.push(
    `<path d="${ringPath(vp, zone.ZoneLoops as [number, number][][])}" fill="none" stroke="${ZONE_STROKE}" stroke-width="${ZONE_WIDTH}" stroke-dasharray="${dash("reference")}"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vp.widthPx}" height="${vp.heightPx}" viewBox="0 0 ${vp.widthPx} ${vp.heightPx}"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
}

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg overlay rasterization failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

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
  tctx.fillStyle = token("page");
  tctx.fillRect(0, 0, PANEL_W, PANEL_H);

  const inner = document.createElement("canvas");
  inner.width = vp.widthPx;
  inner.height = vp.heightPx;
  const ctx = inner.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = token("page");
  ctx.fillRect(0, 0, vp.widthPx, vp.heightPx);

  const [geom, plan] = await Promise.all([
    loadZoneGeometry(runId, zone.Tsv).catch(
      (): ZoneGeometry => ({ rooms: [], polys: new Map(), residues: [] }),
    ),
    loadPlan(runId, zone.Ink).catch(() => null),
  ]);
  if (plan) {
    paintPlan(
      ctx,
      plan,
      vp,
      [zone.ZoneLoops as [number, number][][]],
      PLAN_LAW.blackPoint,
      PLAN_LAW.whitePoint,
      PLAN_LAW.insideZoneOpacity,
      PLAN_LAW.outsideZoneOpacity,
    );
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = FONT;
    ctx.fillText("plan unavailable in this package", 12, 22);
  }
  try {
    const [ink, seals, close, sealClasses] = await Promise.all([
      loadReplaySeedInk(runId, zone.Ink).catch(() => null),
      zone.Seals ? loadRaster(runId, zone.Seals).catch(() => null) : null,
      zone.Close ? loadRaster(runId, zone.Close).catch(() => null) : null,
      zone.Seals ? loadSealClasses(runId, zone.Seals).catch(() => null) : null,
    ]);
    if (close) paintRaster(ctx, close, vp, CLOSE_M);
    if (sealClasses) {
      paintClassRaster(ctx, sealClasses, vp, new Set([2, 4]), SEAL_DOOR);
      paintClassRaster(ctx, sealClasses, vp, new Set([3]), SEAL_RUN);
    } else if (seals) paintRaster(ctx, seals, vp, SEAL_DOOR);
    if (ink) paintRaster(ctx, ink, vp, INK_M);
  } catch {}

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
  ctx.fillStyle = token("page");
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
  ctx.fillStyle = token("page");
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
    ctx.strokeStyle = token("line");
    ctx.strokeRect(x + 0.5, GAP + 14.5, PANEL_W - 1, PANEL_H - 1);
  });

  const alarm = token("alarm");
  lines.forEach((line, i) => {
    ctx.fillStyle = line.tone === "alarm" ? alarm : line.tone === "muted" ? MUTED : TEXT;
    ctx.fillText(line.text, GAP, GAP + 14 + PANEL_H + 10 + i * LINE_H, w - 2 * GAP);
  });
  return out;
}

export function stitchSheet(canvases: HTMLCanvasElement[], header: string): HTMLCanvasElement {
  const w = Math.max(...canvases.map((c) => c.width));
  const h = canvases.reduce((s, c) => s + c.height, 0) + (canvases.length - 1) * GAP + 34;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = token("page");
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
