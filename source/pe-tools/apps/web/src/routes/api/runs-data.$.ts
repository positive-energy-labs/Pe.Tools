// Dev-only file server for the takeoff run pool — the /runs prototypes read run packages
// (report.json + tsv + INKP bins) through this. Pool = <repo>/.artifacts/takeoff-runs or
// PE_TAKEOFF_RUNS_DIR (kaitpw 2026-08-16: .artifacts is fine, wipes are no harm).
// ponytail: dev tool — sync fs reads, no caching, no streaming.
import { createFileRoute } from "@tanstack/react-router";
// Side-effect type import: registers the `server` route-option augmentation.
import "@tanstack/react-start";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function findPool(): string {
  const override = process.env.PE_TAKEOFF_RUNS_DIR;
  if (override) return override;
  // .git may be a directory or a worktree file. Package-local .artifacts is not a root.
  let dir = process.cwd();
  let root = dir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, ".git"))) {
      root = dir; // Prefer the outer checkout over the nested pe-tools repository.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(root, ".artifacts", "takeoff-runs");
}

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".tsv": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream",
  ".png": "image/png",
};

export const Route = createFileRoute("/api/runs-data/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!import.meta.env.DEV) {
          return Response.json({ error: "dev-only" }, { status: 403 });
        }
        const pool = findPool();
        const rel = (params as { _splat?: string })._splat ?? "";
        if (rel === "index.json") {
          const runs = existsSync(pool)
            ? readdirSync(pool, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => {
                  const metaPath = path.join(pool, entry.name, "meta.json");
                  return {
                    id: entry.name,
                    // BOM-strip (﻿): PowerShell-seeded meta.json is UTF-8-with-BOM.
                    meta: existsSync(metaPath)
                      ? JSON.parse(readFileSync(metaPath, "utf8").replace(/^\uFEFF/, ""))
                      : null,
                    hasReport: existsSync(path.join(pool, entry.name, "report.json")),
                  };
                })
                .filter((run) => run.hasReport)
            : [];
          return Response.json({ pool, runs });
        }
        const file = path.normalize(path.join(pool, rel));
        if (!file.startsWith(path.normalize(pool)) || !existsSync(file)) {
          return new Response("not found", { status: 404 });
        }
        return new Response(readFileSync(file), {
          headers: {
            "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
          },
        });
      },
    },
  },
});
