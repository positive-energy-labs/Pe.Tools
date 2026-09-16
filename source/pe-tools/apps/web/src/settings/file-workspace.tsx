import { useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type Reading,
  type SettingsDocumentId,
  type SettingsSnapshot,
  type WorkKey,
} from "@pe/agent-contracts";
import { createLiveSettingsHost } from "#/settings/host";
import { useRoute } from "#/route";
import { settingsManifest, type SettingsHandle } from "#/settings/manifest";
import { ActionButton } from "#/components/lang/action-button";
import { OutcomeLine } from "#/components/lang/outcome";

const host = createLiveSettingsHost();
export const fileSearch = (
  search: Record<string, unknown>,
): { mode?: "file"; module?: string; root?: string; file?: string } => ({
  ...(search.mode === "file" ? { mode: "file" as const } : {}),
  ...(typeof search.module === "string" ? { module: search.module } : {}),
  ...(typeof search.root === "string" ? { root: search.root } : {}),
  ...(typeof search.file === "string" ? { file: search.file } : {}),
});
type FileSearch = ReturnType<typeof fileSearch>;
export interface FileObservation {
  reading: Reading<SettingsSnapshot>;
  refresh: () => Promise<void>;
}

/** A file address resolves once at the host. Both panes subscribe to that existing workspace. */
export function FileWorkspace({
  initial = {},
  family = false,
  children,
}: {
  initial?: Partial<FileSearch>;
  family?: boolean;
  children: (
    scope: WorkKey,
    select: (id: SettingsDocumentId) => Promise<void>,
    observation: FileObservation,
    handle: SettingsHandle,
  ) => ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const paneKey = location.pathname === "/chat" ? (family ? "familyFile" : "settingsFile") : null;
  const search = location.search as Record<string, unknown>;
  const address = fileSearch(
    (paneKey ? (search[paneKey] ?? {}) : search) as Record<string, unknown>,
  );
  const selected = address.file ? address : initial;
  const subject = JSON.stringify([selected.module, selected.root, selected.file]);
  const [reading, setReading] = useState<{ subject: string; snapshot: SettingsSnapshot } | null>(
    null,
  );
  const opened = reading?.subject === subject ? reading.snapshot : null;
  const [failure, setFailure] = useState<{ subject: string; message: string } | null>(null);
  const error = failure?.subject === subject ? failure.message : "";
  const select = async (documentId: SettingsDocumentId) => {
    await navigate({
      to: location.pathname,
      search: (previous: Record<string, unknown>) =>
        paneKey
          ? { ...previous, [paneKey]: fileAddressSearch({}, documentId) }
          : fileAddressSearch(previous, documentId),
    } as Parameters<typeof navigate>[0]);
  };
  useEffect(() => {
    let current = true;
    setReading(null);
    setFailure(null);
    if (selected.file && selected.module && selected.root) {
      void host
        .open({ moduleKey: selected.module, rootKey: selected.root, relativePath: selected.file })
        .then((reading) => {
          if (current) {
            setReading({ subject, snapshot: reading });
          }
        })
        .catch((cause) => {
          if (current) setFailure({ subject, message: String(cause) });
        });
    }
    return () => {
      current = false;
    };
  }, [subject]);
  return (
    <div className="flex min-h-0 flex-col">
      {!opened && (!selected.file || error) && <FilePicker select={select} />}
      {!opened && selected.file && !error && <span>Reading {selected.file}?</span>}
      {error && <OutcomeLine kind="error" label="file read failed" says={error} />}
      {opened?.workspaceId && (
        <FileWorkOwner key={opened.workspaceId} opened={opened}>
          {(scope, observation, handle) => children(scope, select, observation, handle)}
        </FileWorkOwner>
      )}
    </div>
  );
}

export const fileAddressSearch = (previous: Record<string, unknown>, id: SettingsDocumentId) => ({
  ...previous,
  mode: "file" as const,
  module: id.moduleKey,
  root: id.rootKey,
  file: id.relativePath,
});

function FilePicker({ select }: { select: (id: SettingsDocumentId) => Promise<void> }) {
  const [workspaces, setWorkspaces] = useState<Awaited<ReturnType<typeof host.workspaces>>>([]);
  const [files, setFiles] = useState<Awaited<ReturnType<typeof host.tree>>>([]);
  const [bound, setBound] = useState<{
    workspace: string | null;
    module: string | null;
    root: string | null;
    file: string | null;
  }>({
    workspace: null,
    module: null,
    root: null,
    file: null,
  });
  const [error, setError] = useState("");
  useEffect(() => {
    void host
      .workspaces()
      .then((rows) => {
        setWorkspaces(rows);
        setBound((value) => ({ ...value, workspace: rows[0]?.workspaceKey ?? null }));
      })
      .catch((cause) => setError(String(cause)));
  }, []);
  useEffect(() => {
    let current = true;
    setFiles([]);
    if (bound.module && bound.root)
      void host
        .tree(bound.module, bound.root)
        .then((rows) => {
          if (current) setFiles(rows);
        })
        .catch((cause) => setError(String(cause)));
    return () => {
      current = false;
    };
  }, [bound.module, bound.root]);
  const modules = workspaces.find((row) => row.workspaceKey === bound.workspace)?.modules ?? [];
  const roots = modules.find((row) => row.moduleKey === bound.module)?.roots ?? [];
  const pick = (key: "workspace" | "module" | "root" | "file") => (value: string) =>
    setBound((previous) => ({ ...previous, [key]: value || null }));
  const choose = (
    label: string,
    value: string | null,
    options: Array<{ id: string; label: string }>,
    onPick: (value: string) => void,
  ) => (
    <label className="t-small flex items-center gap-1.5">
      {label}
      <select value={value ?? ""} onChange={(event) => onPick(event.target.value)}>
        <option value="">{`a ${label}`}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 p-2">
      {choose(
        "workspace",
        bound.workspace,
        workspaces.map((row) => ({ id: row.workspaceKey, label: row.displayName })),
        pick("workspace"),
      )}
      {choose(
        "module",
        bound.module,
        modules.map((row) => ({ id: row.moduleKey, label: row.moduleKey })),
        pick("module"),
      )}
      {choose(
        "root",
        bound.root,
        roots.map((row) => ({ id: row.rootKey, label: row.displayName })),
        pick("root"),
      )}
      {choose(
        "file",
        bound.file,
        files.map((row) => ({ id: row.path, label: row.relativePath })),
        pick("file"),
      )}
      <ActionButton
        label="open"
        disabled={!bound.file}
        reason="Open the picked settings file."
        onClick={() => {
          const file = files.find((row) => row.path === bound.file);
          if (!file || !bound.module || !bound.root)
            return setError("Choose a file from the settings tree.");
          void select({
            moduleKey: bound.module,
            rootKey: bound.root,
            relativePath: file.relativePath,
          }).catch((cause) => setError(String(cause)));
        }}
      />
      <span className="t-small text-ink-2">File mode requires no Revit connection</span>
      {error ? <OutcomeLine kind="error" label="file discovery failed" says={error} /> : null}
    </div>
  );
}

function FileWorkOwner({
  opened,
  children,
}: {
  opened: SettingsSnapshot;
  children: (scope: WorkKey, observation: FileObservation, handle: SettingsHandle) => ReactNode;
}) {
  const scope: WorkKey = useMemo(
    () => ({ route: "settings", target: null, work: opened.workspaceId! }),
    [opened.workspaceId],
  );
  const manifest = useMemo(
    () => settingsManifest({ scope, documentId: opened.documentId }),
    [scope, opened.documentId],
  );
  const [reading, setReading] = useState<Reading<SettingsSnapshot>>({
    state: "ready",
    observation: opened,
  });
  const route = useRoute(manifest, {
    work: opened.workspaceId!,
    provided: { document: reading },
  });
  const generation = useRef(0);
  const initialized = useRef(false);
  const observation =
    reading.state === "ready"
      ? reading.observation
      : "previous" in reading && reading.previous
        ? reading.previous
        : opened;
  useEffect(() => {
    if (!route.work.current || route.work.doc?.basis || initialized.current) return;
    initialized.current = true;
    void route.actions.open.run({ documentId: opened.documentId });
  }, [route.work.current, route.work.doc?.basis, route.actions.open, opened.documentId]);
  useEffect(() => () => void generation.current++, []);
  const refresh = async () => {
    const attempt = ++generation.current;
    setReading({ state: "stale", previous: observation, reason: "dirtied" });
    try {
      const next = await host.open(opened.documentId);
      if (attempt === generation.current) setReading({ state: "ready", observation: next });
    } catch (cause) {
      if (attempt === generation.current) {
        const message = String(cause);
        setReading({ state: "failed", message, previous: observation });
      }
    }
  };
  return children(scope, { reading, refresh }, route);
}
