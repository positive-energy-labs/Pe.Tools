// THROWAWAY — /runs feedback-loop round 1 (proto). Dev-only export sink for the staging
// variants: accepts composited PNGs (base64) + a manifest, writes them under
// <pool>/_exports/<stamp>/, returns the absolute paths, and — for the snip verb — opens the
// first PNG in Windows Snipping Tool for freehand annotation (the drawing UI Windows already
// ships; deliberately not rebuilt in the browser).
//
// Snipping Tool launch: verified live on this Windows 11 machine 2026-08-17 —
// `SnippingTool.exe <file>` IGNORES the file argument (opens blank), but the
// `ms-screensketch:edit?filePath=<url-encoded>` protocol opens the PNG in the editor.
import { createFileRoute } from "@tanstack/react-router";
// Side-effect type import: registers the `server` route-option augmentation.
import "@tanstack/react-start";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Pool resolution duplicated from runs-data.$.ts (route files export route defs, not helpers;
// proto keeps its hands off the promoted file).
function findPool(): string {
  const override = process.env.PE_TAKEOFF_RUNS_DIR;
  if (override) return override;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, ".git")) || existsSync(path.join(dir, ".artifacts"))) {
      return path.join(dir, ".artifacts", "takeoff-runs");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), ".artifacts", "takeoff-runs");
}

type ExportPayload = {
  stamp: string;
  openSnip?: boolean;
  items: { fileName: string; pngBase64: string }[];
  sheetBase64?: string | null;
  manifest: { items: { png: string | null }[] } & Record<string, unknown>;
};

/** OS-clipboard fallback payload — used when the browser denies navigator.clipboard (no user
 * activation, unfocused pane). Windows-native Set-Clipboard is the one clipboard that always
 * exists on this machine; the text also lands in <dir>/clip.txt as the export's own record. */
type ClipboardPayload = {
  clipboard: { text?: string; imagePath?: string; dir?: string };
};

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

function setOsClipboard(req: ClipboardPayload["clipboard"], pool: string): { ok: boolean; detail: string } {
  if (req.text !== undefined) {
    // Round-trip through a UTF-8 file — clip.exe mangles non-ASCII, PS args mangle newlines.
    const dir = req.dir && path.normalize(req.dir).startsWith(path.normalize(pool)) ? req.dir : pool;
    mkdirSync(dir, { recursive: true });
    const txt = path.join(dir, "clip.txt");
    writeFileSync(txt, req.text, "utf8");
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", `Get-Content -Raw -Encoding UTF8 ${psq(txt)} | Set-Clipboard`],
      { timeout: 15_000 },
    );
    return { ok: r.status === 0, detail: r.status === 0 ? txt : String(r.stderr) };
  }
  if (req.imagePath) {
    const img = path.normalize(req.imagePath);
    if (!img.startsWith(path.normalize(pool)) || !existsSync(img)) {
      return { ok: false, detail: "image path outside pool or missing" };
    }
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile(${psq(img)}); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`,
      ],
      { timeout: 15_000 },
    );
    return { ok: r.status === 0, detail: r.status === 0 ? img : String(r.stderr) };
  }
  return { ok: false, detail: "empty clipboard request" };
}

export const Route = createFileRoute("/api/runs-export")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!import.meta.env.DEV) {
          return Response.json({ error: "dev-only" }, { status: 403 });
        }
        const body = (await request.json()) as ExportPayload | ClipboardPayload;
        if ("clipboard" in body) {
          const result = setOsClipboard(body.clipboard, findPool());
          return Response.json(result, { status: result.ok ? 200 : 500 });
        }
        const stamp = (body.stamp ?? "").replace(/[^0-9-]/g, "");
        if (!stamp || !Array.isArray(body.items) || body.items.length === 0) {
          return Response.json({ error: "bad payload" }, { status: 400 });
        }
        const dir = path.join(findPool(), "_exports", stamp);
        mkdirSync(dir, { recursive: true });

        const files: { name: string; path: string }[] = [];
        for (const item of body.items) {
          const name = path.basename(item.fileName); // no traversal
          const abs = path.join(dir, name);
          writeFileSync(abs, Buffer.from(item.pngBase64, "base64"));
          files.push({ name, path: abs });
        }
        if (body.sheetBase64) {
          const abs = path.join(dir, "sheet.png");
          writeFileSync(abs, Buffer.from(body.sheetBase64, "base64"));
          files.push({ name: "sheet.png", path: abs });
        }

        // Fill the absolute PNG paths into the manifest before writing it — the manifest on
        // disk is complete; the client never has to guess server paths.
        const manifest = body.manifest;
        manifest.items?.forEach((m, i) => {
          m.png = files[i]?.path ?? null;
        });
        const manifestPath = path.join(dir, "manifest.json");
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        let opened: string | null = null;
        if (body.openSnip && files.length > 0) {
          const target = files[0]!.path;
          const url = `ms-screensketch:edit?filePath=${encodeURIComponent(target)}`;
          // cmd start handles protocol activation; detached so the dev server never waits.
          spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
          opened = target;
        }

        return Response.json({ dir, files, manifestPath, opened });
      },
    },
  },
});
