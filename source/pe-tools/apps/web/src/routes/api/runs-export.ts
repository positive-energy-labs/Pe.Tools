// Dev-only export sink for the /runs feedback loop: accepts composited PNGs (base64) + a
// manifest + a clip-block template, writes them under <pool>/_exports/<stamp>/ (a COLLIDING
// stamp gets a numeric suffix — an export never overwrites an earlier set), resolves the
// template's {{DIR}}/{{SET}} placeholders, ALWAYS writes clip.txt, sets the OS clipboard as
// the PRIMARY copy path (round-2 ruling; navigator.clipboard is the client's fallback), and —
// for the snip verb — opens the first PNG in Windows Snipping Tool.
//
// Rehydration has no handler here on purpose: manifest.json lives inside the pool, so the
// pool file server (runs-data.$.ts) already serves /_exports/<stamp>/manifest.json.
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

// Pool resolution duplicated from runs-data.$.ts (route files export route defs, not helpers).
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
  origin?: string;
  openSnip?: boolean;
  clipboardVerb?: "text" | "image" | null;
  clipTemplate?: string;
  items: { fileName: string; pngBase64: string }[];
  sheetBase64?: string | null;
  manifest: {
    stamp: string | null;
    setUrl: string | null;
    items: { png: string | null }[];
  } & Record<string, unknown>;
};

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Windows-native clipboard — the PRIMARY copy path (Set-Clipboard needs no user activation
 * and works when the pane is embedded/unfocused, where navigator.clipboard throws). */
function setOsClipboard(req: { textPath?: string; imagePath?: string }): {
  ok: boolean;
  detail: string;
} {
  if (req.textPath) {
    // Round-trip through the UTF-8 clip.txt — clip.exe mangles non-ASCII, PS args mangle newlines.
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-Command",
        `Get-Content -Raw -Encoding UTF8 ${psq(req.textPath)} | Set-Clipboard`,
      ],
      { timeout: 15_000 },
    );
    return { ok: r.status === 0, detail: r.status === 0 ? req.textPath : String(r.stderr) };
  }
  if (req.imagePath) {
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile(${psq(req.imagePath)}); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`,
      ],
      { timeout: 15_000 },
    );
    return { ok: r.status === 0, detail: r.status === 0 ? req.imagePath : String(r.stderr) };
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
        const body = (await request.json()) as ExportPayload;
        const requested = (body.stamp ?? "").replace(/[^0-9-]/g, "");
        if (!requested || !Array.isArray(body.items) || body.items.length === 0) {
          return Response.json({ error: "bad payload" }, { status: 400 });
        }

        // NEVER overwrite an existing set — a colliding stamp gets a numeric suffix.
        const exportsRoot = path.join(findPool(), "_exports");
        let stamp = requested;
        for (let n = 2; existsSync(path.join(exportsRoot, stamp)); n++) {
          stamp = `${requested}-${n}`;
        }
        const dir = path.join(exportsRoot, stamp);
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

        const setUrl = `${body.origin ?? ""}/runs?set=${stamp}`;

        // Fill stamp/setUrl/PNG paths into the manifest before writing it — the manifest on
        // disk is complete and self-describing; the client never guesses server paths.
        const manifest = body.manifest;
        manifest.stamp = stamp;
        manifest.setUrl = setUrl;
        manifest.items?.forEach((m, i) => {
          m.png = files[i]?.path ?? null;
        });
        const manifestPath = path.join(dir, "manifest.json");
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        // clip.txt is ALWAYS written (every verb) — the export dir carries its own
        // paste-ready record even when no clipboard was touched.
        const clipText = (body.clipTemplate ?? "")
          .replaceAll("{{DIR}}/", dir + path.sep)
          .replaceAll("{{SET}}", setUrl);
        const clipPath = path.join(dir, "clip.txt");
        writeFileSync(clipPath, clipText, "utf8");

        let clipboard: { ok: boolean; detail: string } | null = null;
        if (body.clipboardVerb === "text") {
          clipboard = setOsClipboard({ textPath: clipPath });
        } else if (body.clipboardVerb === "image") {
          const sheet = files.find((f) => f.name === "sheet.png");
          clipboard = sheet
            ? setOsClipboard({ imagePath: sheet.path })
            : { ok: false, detail: "sheet.png missing from the export" };
        }

        let opened: string | null = null;
        if (body.openSnip && files.length > 0) {
          const target = files[0]!.path;
          const url = `ms-screensketch:edit?filePath=${encodeURIComponent(target)}`;
          // cmd start handles protocol activation; detached so the dev server never waits.
          spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
          opened = target;
        }

        return Response.json({
          dir,
          stamp,
          files,
          manifestPath,
          clipPath,
          clipText,
          setUrl,
          clipboard,
          opened,
        });
      },
    },
  },
});
