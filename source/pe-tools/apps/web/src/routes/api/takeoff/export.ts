import { createFileRoute } from "@tanstack/react-router";
// Side-effect type import: registers the `server` route-option augmentation.
import "@tanstack/react-start";

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { ExportRequest, ExportResponse } from "#/takeoff/export";

/**
 * Pipeline step 6's server seam: run `eval/rhvac/sync-rhvac.ps1` for the /takeoff route.
 *
 * The .r10 lane is 32-bit Jet and lives in PowerShell; the browser cannot reach it, so this
 * dev-lane endpoint spawns it. Two safety rules are enforced HERE, not just in the script:
 *   - the caller's file is copied into a scratch directory and the sync runs on the COPY, so a
 *     committed fixture can never be mutated in place;
 *   - the script's own envelope (lock refusal, non-Room table validation, atomic swap with a
 *     timestamped backup) is left entirely intact — this endpoint adds nothing and skips nothing.
 *
 * seam: this belongs behind an `rhvac.sync` host op, alongside rhvac.open/save. Until then the
 * route is dev-lane only (the installed lane serves static files with no node process).
 */
export const Route = createFileRoute("/api/takeoff/export")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ExportRequest;
        if (typeof body?.sourcePath !== "string" || body.sourcePath.trim().length === 0)
          return Response.json({ error: "sourcePath is required" }, { status: 400 });
        if (!Array.isArray(body.updates) || body.updates.length === 0)
          return Response.json({ error: "no staged edits to export" }, { status: 400 });

        const sourcePath = resolve(body.sourcePath.trim());
        if (!existsSync(sourcePath))
          return Response.json({ error: `.r10 not found: ${sourcePath}` }, { status: 400 });

        const syncScript = findSyncScript();
        if (!syncScript)
          return Response.json(
            { error: "eval/rhvac/sync-rhvac.ps1 not found above the web app" },
            { status: 500 },
          );

        const scratch = mkdtempSync(join(tmpdir(), "pe-takeoff-export-"));
        const workingTarget = join(scratch, basename(sourcePath));
        copyFileSync(sourcePath, workingTarget);
        const editsPath = join(scratch, "edits.json");
        writeFileSync(
          editsPath,
          JSON.stringify({ updates: body.updates, deletes: [] }, null, 1),
          "utf8",
        );
        const backupDir = join(scratch, "backups");
        mkdirSync(backupDir, { recursive: true });

        const args = [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          syncScript,
          "-Target",
          workingTarget,
          "-EditsJson",
          editsPath,
          "-BackupDir",
          backupDir,
          ...(body.whatIf ? ["-WhatIf"] : []),
        ];
        const run = await spawnPowerShell(args);
        const backupPath = /backup:\s*(\S+)/.exec(run.stdout)?.[1] ?? null;

        return Response.json({
          ok: run.code === 0,
          workingTarget,
          command: `powershell ${args.join(" ")}`,
          stdout: run.stdout,
          stderr: run.stderr,
          exitCode: run.code,
          backupPath,
        } satisfies ExportResponse);
      },
    },
  },
});

/** Walk up from the web app to the repo root that owns the .r10 safety envelope. */
function findSyncScript(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "eval", "rhvac", "sync-rhvac.ps1");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function spawnPowerShell(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = spawn("powershell", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => done({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}
