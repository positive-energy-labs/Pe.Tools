import { useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  memberWork,
  settingsRouteState,
  type PodMember,
  type Reading,
  type SettingsSnapshot,
  type WorkKey,
} from "@pe/agent-contracts";
import { openMember } from "#/settings/host";
import { podHost } from "#/route/pods";
import { useRoute, type PodRow } from "#/route";
import { settingsManifest, type SettingsHandle } from "#/settings/manifest";
import { ActionButton } from "#/components/lang/action-button";
import { OutcomeLine } from "#/components/lang/outcome";

export const fileSearch = (
  search: Record<string, unknown>,
): { mode?: "file"; pod?: string; file?: string } => ({
  ...(search.mode === "file" ? { mode: "file" as const } : {}),
  ...(typeof search.pod === "string" ? { pod: search.pod } : {}),
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
    select: (member: PodMember) => Promise<void>,
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
  const subject = JSON.stringify([selected.pod, selected.file]);
  const [reading, setReading] = useState<{ subject: string; snapshot: SettingsSnapshot } | null>(
    null,
  );
  const opened = reading?.subject === subject ? reading.snapshot : null;
  const [failure, setFailure] = useState<{ subject: string; message: string } | null>(null);
  const error = failure?.subject === subject ? failure.message : "";
  const select = async (member: PodMember) => {
    await navigate({
      to: location.pathname,
      search: (previous: Record<string, unknown>) =>
        paneKey
          ? { ...previous, [paneKey]: fileAddressSearch({}, member) }
          : fileAddressSearch(previous, member),
    } as Parameters<typeof navigate>[0]);
  };
  useEffect(() => {
    let current = true;
    setReading(null);
    setFailure(null);
    if (selected.file && selected.pod) {
      void openMember({ pod: selected.pod, path: selected.file })
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
      {opened && (
        <FileWorkOwner key={memberWork(opened.member)} opened={opened}>
          {(scope, observation, handle) => children(scope, select, observation, handle)}
        </FileWorkOwner>
      )}
    </div>
  );
}

export const fileAddressSearch = (previous: Record<string, unknown>, member: PodMember) => ({
  ...previous,
  mode: "file" as const,
  pod: member.pod,
  file: member.path,
});

/** Pods and their JSON members; picking one only navigates. No Revit is needed. */
function FilePicker({ select }: { select: (member: PodMember) => Promise<void> }) {
  const [pods, setPods] = useState<readonly PodRow[]>([]);
  const [pod, setPod] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void podHost
      .list()
      .then((rows) => {
        setPods(rows);
        setPod(rows[0]?.id ?? null);
      })
      .catch((cause) => setError(String(cause)));
  }, []);
  const members =
    pods
      .find((row) => row.id === pod)
      ?.members.filter((member) => member.path.toLowerCase().endsWith(".json")) ?? [];
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
        "pod",
        pod,
        pods.map((row) => ({ id: row.id, label: row.name })),
        (value) => (setPod(value || null), setFile(null)),
      )}
      {choose(
        "member",
        file,
        members.map((row) => ({ id: row.path, label: row.path })),
        (value) => setFile(value || null),
      )}
      <ActionButton
        label="open"
        disabled={!pod || !file}
        reason="Open the picked pod member."
        onClick={() => {
          if (!pod || !file) return setError("Choose a member from a pod.");
          void select({ pod, path: file }).catch((cause) => setError(String(cause)));
        }}
      />
      <span className="t-small text-ink-2">Members open without a Revit connection</span>
      {error ? <OutcomeLine kind="error" label="pod discovery failed" says={error} /> : null}
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
  const work = memberWork(opened.member);
  const scope: WorkKey = useMemo(
    () => ({ route: settingsRouteState.route, target: null, work }),
    [work],
  );
  const manifest = useMemo(
    () => settingsManifest({ scope, member: opened.member }),
    [scope, opened.member],
  );
  const [reading, setReading] = useState<Reading<SettingsSnapshot>>({
    state: "ready",
    observation: opened,
  });
  const route = useRoute(manifest, {
    work,
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
    void route.actions.open.run({ member: opened.member });
  }, [route.work.current, route.work.doc?.basis, route.actions.open, opened.member]);
  useEffect(() => () => void generation.current++, []);
  const refresh = async () => {
    const attempt = ++generation.current;
    setReading({ state: "stale", previous: observation, reason: "dirtied" });
    try {
      const next = await openMember(opened.member);
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
