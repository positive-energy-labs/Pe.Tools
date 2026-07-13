import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Check, CheckCheck, RefreshCw, RotateCcw, ShieldCheck, Sparkles, X } from "lucide-react";

import {
  type SettingsFieldState,
  type SettingsRouteDocument,
  settingsFieldSegments,
  settingsRouteState,
} from "@pe/agent-contracts";
import { SettingsFileKind, type SettingsFileEntry } from "@pe/host-contracts/operation-types";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { HostConnectionPill } from "#/host/issues";
import { useTreeQuery, useWorkspacesQuery } from "#/host/queries";
import { useRouteState } from "#/workbench/route-state";

/**
 * /settings — the substrate-backed replacement for the old settings-prototype form.
 *
 * All collaborative state lives in the `route:settings` document: pea opens a
 * schema-backed host settings file into the snapshot and proposes field values
 * (dot-paths into the parsed raw JSON); the engineer reviews, stages, validates, and
 * saves. Writes go through the route-state dispatcher as `actor:"human"` — pea's
 * proposals arrive identically over SSE. The picker still speaks the host directly
 * (settings.workspaces / settings.tree) to choose which document `open` targets.
 */
export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function isAuthoringFile(entry: SettingsFileEntry) {
  return (
    entry.kind !== SettingsFileKind.Fragment &&
    entry.kind !== SettingsFileKind.Schema &&
    !entry.isFragment &&
    !entry.isSchema &&
    entry.relativePath.toLowerCase().endsWith(".json")
  );
}

function SettingsRoute() {
  const route = useRouteState(settingsRouteState);
  const document = route.slice;
  const snapshot = document?.snapshot ?? null;

  const [workspaceKey, setWorkspaceKey] = useState<string>();
  const [moduleKey, setModuleKey] = useState<string>();
  const [rootKey, setRootKey] = useState<string>();
  const [filePath, setFilePath] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workspacesQuery = useWorkspacesQuery();
  const workspaces = workspacesQuery.data?.workspaces ?? [];
  const workspace = workspaces.find((w) => w.workspaceKey === workspaceKey);
  const modules = workspace?.modules ?? [];
  const module = modules.find((m) => m.moduleKey === moduleKey);
  const roots = module?.roots ?? [];

  const treeRequest =
    moduleKey && rootKey
      ? {
          moduleKey,
          rootKey,
          subDirectory: "",
          recursive: true,
          includeFragments: false,
          includeSchemas: false,
        }
      : undefined;
  const treeQuery = useTreeQuery(treeRequest, { enabled: Boolean(treeRequest) });
  const files = useMemo(
    () => (treeQuery.data?.files ?? []).filter(isAuthoringFile),
    [treeQuery.data?.files],
  );

  const rows = useMemo(() => (document ? buildFieldRows(document) : []), [document]);
  const stagedCount = rows.filter((row) => row.field?.hasStaged).length;
  const attentionCount = rows.filter((row) => row.field?.review === "attention").length;
  const proposalCount = rows.filter((row) => row.field?.proposal && !row.field.hasStaged).length;
  const canSave = stagedCount > 0 && attentionCount === 0;

  const runCommand = async (name: string, input?: unknown) => {
    setBusy(name);
    setError(null);
    try {
      const result = await route.command(name, input);
      if (!result.ok) setError(result.error ?? result.hint ?? `${name} failed.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${name} failed.`);
    } finally {
      setBusy(null);
    }
  };

  const applyPatches = async (patches: { path: (string | number)[]; value?: unknown }[]) => {
    setError(null);
    const result = await route.apply(patches);
    if (!result.ok) setError(result.error ?? result.hint ?? "Update failed.");
  };

  const openFile = (relativePath?: string) => {
    setFilePath(relativePath);
    if (moduleKey && rootKey && relativePath)
      void runCommand("open", { documentId: { moduleKey, rootKey, relativePath } });
  };

  const validation = snapshot?.validation;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--paper)]">
      {/* ── header ribbon ── */}
      <header className="shrink-0 border-b border-[var(--line-2)] px-5 pb-2.5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[var(--clay-ink)]">
              Settings
            </h1>
            <span className="text-xs text-[var(--lichen)]">
              {snapshot
                ? `${snapshot.documentId.moduleKey} · ${snapshot.documentId.relativePath}${
                    snapshot.versionToken ? ` · v${snapshot.versionToken}` : ""
                  }`
                : "no document open"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <HostConnectionPill connected={route.connected} label="Bridge connected" />
            {route.peaActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-[2px] bg-[var(--pea-tint)] px-2 py-0.5 text-xs font-medium text-[var(--cat-green)]">
                <Sparkles className="size-3 animate-pulse" />
                pea is working…
              </span>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              disabled={!snapshot || busy != null}
              onClick={() => void runCommand("refresh")}
            >
              <RefreshCw className={busy === "refresh" ? "animate-spin" : ""} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!snapshot || busy != null}
              onClick={() => void runCommand("validate", { includeProposals: false })}
            >
              <ShieldCheck />
              Validate
            </Button>
            <Button
              size="sm"
              disabled={!canSave || busy != null}
              title={
                stagedCount === 0
                  ? "nothing staged"
                  : attentionCount > 0
                    ? `${attentionCount} field${attentionCount === 1 ? "" : "s"} need attention`
                    : undefined
              }
              onClick={() => void runCommand("save")}
              className="bg-[var(--cat-green)] text-white hover:bg-[var(--cat-green)]/85 disabled:opacity-50"
            >
              <CheckCheck />
              Save {stagedCount}
            </Button>
          </div>
        </div>

        {/* subline: metrics / validation / error */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <Metric value={proposalCount} label="open proposals" />
          <Metric value={stagedCount} label="staged" />
          <Metric value={attentionCount} label="need attention" issue />
          {validation ? (
            <span className={validation.isValid ? "text-[var(--cat-green)]" : "text-[var(--fail)]"}>
              {validation.isValid
                ? "valid"
                : `${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}`}
            </span>
          ) : null}
          {document?.savedAt ? (
            <span className="text-[var(--lichen)]">saved {timeAgo(document.savedAt)}</span>
          ) : null}
          {error ? <span className="text-[var(--cat-clay)]">{error}</span> : null}
          {route.error ? <span className="text-[var(--cat-clay)]">{route.error}</span> : null}
        </div>
      </header>

      {/* ── picker ── */}
      <div className="shrink-0 border-b border-[var(--line-2)] bg-[var(--paper)] px-5 py-2.5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Picker
            id="workspace"
            label="Workspace"
            value={workspaceKey}
            placeholder="Choose a workspace"
            onChange={(v) => {
              setWorkspaceKey(v);
              setModuleKey(undefined);
              setRootKey(undefined);
              setFilePath(undefined);
            }}
            options={workspaces.map((w) => ({
              value: w.workspaceKey,
              label: w.displayName || w.workspaceKey,
            }))}
          />
          <Picker
            id="module"
            label="Module"
            value={moduleKey}
            placeholder="Choose a module"
            disabled={modules.length === 0}
            onChange={(v) => {
              setModuleKey(v);
              const nextModule = modules.find((m) => m.moduleKey === v);
              const defaultRoot =
                nextModule?.roots.find((r) => r.rootKey === nextModule.defaultRootKey) ??
                nextModule?.roots[0];
              setRootKey(defaultRoot?.rootKey);
              setFilePath(undefined);
            }}
            options={modules.map((m) => ({ value: m.moduleKey, label: m.moduleKey }))}
          />
          <Picker
            id="root"
            label="Root"
            value={rootKey}
            placeholder="Choose a root"
            disabled={roots.length === 0}
            onChange={(v) => {
              setRootKey(v);
              setFilePath(undefined);
            }}
            options={roots.map((r) => ({ value: r.rootKey, label: r.displayName || r.rootKey }))}
          />
          <Picker
            id="file"
            label="Authoring file"
            value={filePath}
            placeholder="Choose a JSON file"
            disabled={files.length === 0}
            onChange={openFile}
            options={files.map((f) => ({ value: f.relativePath, label: f.relativePath }))}
          />
        </div>
      </div>

      {/* ── field grid ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {snapshot ? (
          rows.length > 0 ? (
            <div className="mx-auto max-w-3xl divide-y divide-[var(--line-2)] rounded-[2px] border border-[var(--line)]">
              {rows.map((row) => (
                <FieldRow
                  key={row.path}
                  row={row}
                  busy={busy != null}
                  onApprove={(value) =>
                    void applyPatches([
                      { path: ["fields", row.path, "staged"], value },
                      { path: ["fields", row.path, "hasStaged"], value: true },
                      { path: ["fields", row.path, "review"], value: "good" },
                    ])
                  }
                  onDeny={() =>
                    void applyPatches([
                      { path: ["fields", row.path, "proposal"] },
                      { path: ["fields", row.path, "review"], value: "none" },
                    ])
                  }
                  onUndo={() =>
                    void applyPatches([
                      { path: ["fields", row.path, "staged"] },
                      { path: ["fields", row.path, "hasStaged"], value: false },
                      { path: ["fields", row.path, "review"], value: "none" },
                    ])
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyNote>This document has no fields yet.</EmptyNote>
          )
        ) : (
          <EmptyNote>
            Choose a workspace, module, root, and authoring file to open a document.
          </EmptyNote>
        )}
      </div>
    </main>
  );
}

/* ── field rows ──────────────────────────────────────────────────────────── */

interface FieldRow {
  path: string;
  current: unknown;
  field?: SettingsFieldState;
}

function buildFieldRows(document: SettingsRouteDocument): FieldRow[] {
  const parsed = safeParse(document.snapshot?.rawContent);
  const leafPaths = parsed ? flattenLeafPaths(parsed) : [];
  const paths = new Set<string>([...leafPaths, ...Object.keys(document.fields)]);
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      current: parsed ? valueAtPath(parsed, settingsFieldSegments(path)) : undefined,
      field: document.fields[path],
    }));
}

function FieldRow({
  row,
  busy,
  onApprove,
  onDeny,
  onUndo,
}: {
  row: FieldRow;
  busy: boolean;
  onApprove: (value: unknown) => void;
  onDeny: () => void;
  onUndo: () => void;
}) {
  const field = row.field;
  const staged = field?.hasStaged ?? false;
  const proposal = !staged ? field?.proposal : undefined;
  const attention = field?.review === "attention";

  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs font-medium text-[var(--clay-ink)]">
          {row.path}
        </div>
        <div className="truncate text-xs text-[var(--slate)]">
          <span className="text-[var(--lichen)]">current:</span> {display(row.current)}
          {staged ? (
            <>
              {" "}
              <span className="text-[var(--cat-green)]">→ staged:</span>{" "}
              <span className="text-[var(--clay-ink)]">{display(field?.staged)}</span>
            </>
          ) : proposal ? (
            <>
              {" "}
              <span className="text-[var(--pe-blue)]">→ pea:</span>{" "}
              <span className="text-[var(--clay-ink)]">{display(proposal.value)}</span>
            </>
          ) : null}
        </div>
        {proposal && (proposal.confidence || proposal.note) ? (
          <div
            className={`truncate text-[10px] ${attention ? "text-[var(--fail)]" : "text-[var(--lichen)]"}`}
          >
            {[proposal.confidence, proposal.note].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </div>

      {staged ? (
        <Button
          size="icon-sm"
          variant="ghost"
          title="Undo approval"
          disabled={busy}
          onClick={onUndo}
        >
          <RotateCcw />
        </Button>
      ) : proposal ? (
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Deny suggestion"
            disabled={busy}
            onClick={onDeny}
          >
            <X />
          </Button>
          <Button
            size="icon-sm"
            title="Approve and stage suggestion"
            disabled={busy}
            onClick={() => onApprove(proposal.value)}
          >
            <Check />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ── small pieces ────────────────────────────────────────────────────────── */

function Picker({
  id,
  label,
  value,
  placeholder,
  disabled,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="tele-label text-[var(--lichen)]">
        {label}
      </Label>
      <Select
        value={value ?? "__none"}
        onValueChange={(v: string | null) => onChange(v === "__none" || !v ? undefined : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Metric({
  value,
  label,
  issue = false,
}: {
  value: number;
  label: string;
  issue?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-1 ${issue && value > 0 ? "text-[var(--fail)]" : "text-[var(--slate)]"}`}
    >
      <span className="tele">{value}</span>
      <span className="tele-label">{label}</span>
    </span>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto mt-6 max-w-3xl rounded-[2px] border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--lichen)]">
      {children}
    </div>
  );
}

/* ── json helpers ────────────────────────────────────────────────────────── */

function safeParse(rawContent: string | null | undefined): Record<string, unknown> | null {
  if (!rawContent?.trim()) return null;
  try {
    const parsed = JSON.parse(rawContent);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every leaf JSON path (dot-joined). Objects recurse; arrays/primitives are leaves. */
function flattenLeafPaths(value: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child != null && typeof child === "object" && !Array.isArray(child)) {
      out.push(...flattenLeafPaths(child as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function valueAtPath(root: Record<string, unknown>, segments: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Compact relative-time label for an ISO timestamp. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
