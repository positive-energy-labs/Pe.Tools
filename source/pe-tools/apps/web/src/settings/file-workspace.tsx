import { JsonView } from "#/settings-panes/json-editor";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  settingsRouteState,
  type SettingsDocumentId,
  type SettingsSnapshot,
  type WorkKey,
} from "@pe/agent-contracts";
import { createLiveSettingsHost } from "#/settings/host";
import { useRouteState } from "#/workbench/route-state";
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

/** A file address resolves once at the host. Both panes subscribe to that existing workspace. */
export function FileWorkspace({
  initial = {},
  family = false,
  children,
}: {
  initial?: Partial<FileSearch>;
  family?: boolean;
  children: (scope: WorkKey, select: (id: SettingsDocumentId) => Promise<void>) => ReactNode;
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
      {!opened && (!selected.file || error) && <FilePicker family={family} select={select} />}
      {!opened && selected.file && !error && <span>Reading {selected.file}?</span>}
      {error && <OutcomeLine kind="error" label="file read failed" says={error} />}
      {opened?.workspaceId && (
        <FileWorkOwner key={opened.workspaceId} opened={opened}>
          {(scope) => children(scope, select)}
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

function FilePicker({
  family,
  select,
}: {
  family: boolean;
  select(id: SettingsDocumentId): Promise<void>;
}) {
  const [workspaces, setWorkspaces] = useState<Awaited<ReturnType<typeof host.workspaces>>>([]);
  const [files, setFiles] = useState<Awaited<ReturnType<typeof host.tree>>>([]);
  const [bound, setBound] = useState<{
    workspace: string | null;
    module: string | null;
    root: string | null;
    file: string | null;
  }>({
    workspace: null,
    module: family ? "FamilyFoundry" : null,
    root: family ? "models" : null,
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
  children: (scope: WorkKey) => ReactNode;
}) {
  const scope: WorkKey = { route: "settings", target: null, work: opened.workspaceId! };
  const state = useRouteState(settingsRouteState, scope);
  const [observation, setObservation] = useState(opened);
  const [readError, setReadError] = useState("");
  useEffect(() => {
    if (state.hydrated && !state.slice?.basis)
      void state
        .command("open", { documentId: opened.documentId })
        .catch((cause) => setReadError(String(cause)));
  }, [state.hydrated]);
  const basis = state.slice?.basis;
  const query = new URLSearchParams({
    mode: "file",
    module: opened.documentId.moduleKey,
    root: opened.documentId.rootKey,
    file: opened.documentId.relativePath,
  });
  const refresh = async () => {
    try {
      setObservation(await host.open(opened.documentId));
      setReadError("");
    } catch (cause) {
      setReadError(String(cause));
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 p-2">
        <span>{opened.path}</span>
        <a href={`/settings?${query}`}>Settings pane</a>
        <a href={`/family?${query}`}>Family pane</a>
        <ActionButton
          label="Read disk"
          reason="Observe disk without rebasing authored work"
          onClick={() => void refresh()}
        />
        {basis && observation.versionToken !== basis.versionToken && (
          <>
            <OutcomeLine kind="advisory" label="disk differs from edit basis" />
            <ActionButton
              label="Adopt disk and discard old edits"
              reason="Replace the basis and discard existing proposals and staged edits"
              onClick={() =>
                void state
                  .command(
                    "adopt",
                    { documentId: opened.documentId, versionToken: observation.versionToken },
                    undefined,
                    state.revision ?? undefined,
                  )
                  .catch((cause) => setReadError(String(cause)))
              }
            />
          </>
        )}
      </div>
      {readError && <OutcomeLine kind="error" label="file observation failed" says={readError} />}
      {state.failure && (
        <OutcomeLine kind="error" label="file work refused" says={state.failure.message} />
      )}
      {/* The current observation's own text. Expanding is display-only: it does not read the
          file again, adopt disk, or reset authored fields. */}
      <details className="p-2">
        <summary>Disk observation · raw text as stored</summary>
        <JsonView code={observation.rawContent} />
        {observation.validation?.issues.map((issue, index) => (
          <p key={index}>
            {issue.path}: {issue.message}
          </p>
        ))}
      </details>
      {children(scope)}
    </>
  );
}
