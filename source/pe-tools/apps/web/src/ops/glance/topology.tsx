import { useEffect, useState } from "react";
import { callHostDynamic } from "#/host/client";
import type { SessionLane } from "#/host/target";
import { LaneBadge, LiveDot } from "#/host/target-ui";
import { Chip, EmptyState, MonoNote, Provenance } from "#/ops/primitives";
import { asNumber, asRecord, asRecords, asString, text } from "#/ops/registry";
import type { SyntheticOp, SyntheticViewProps } from "#/ops/synthetic";

/**
 * glance.session-topology — the operator's map. Host process on the left,
 * bridge sessions laned off it, open documents as leaves. Every edge is a
 * hairline; every measured value is tele; dead sessions stay visible, muted.
 */

const DOC_FETCH_BOUND = 12;

function asLane(value: unknown): SessionLane {
  return value === "rrd" || value === "sandbox" || value === "installed" ? value : "unknown";
}

/* ── staged per-session document fetch ────────────────────────────────────── */

type DocFetch =
  | { state: "loading" }
  | { state: "ok"; docs: Record<string, unknown>[]; hasActive: boolean }
  | { state: "error"; error: string }
  | { state: "skipped" };

function useSessionDocuments(sessionIds: string[]): Record<string, DocFetch> {
  const [fetches, setFetches] = useState<Record<string, DocFetch>>({});
  const idsKey = sessionIds.join("|");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    const bounded = ids.slice(0, DOC_FETCH_BOUND);
    let alive = true;
    setFetches(
      Object.fromEntries(
        ids.map((id) => [
          id,
          bounded.includes(id) ? { state: "loading" as const } : { state: "skipped" as const },
        ]),
      ),
    );
    for (const sessionId of bounded) {
      // The synthetic `call` prop is bound to the page's session scope; topology
      // needs per-session scope, so it goes to the client directly. Readonly op.
      void callHostDynamic("revit.context.document-session", undefined, {
        bridgeSessionId: sessionId,
      })
        .then((data) => {
          if (!alive) return;
          const res = asRecord(data);
          setFetches((prev) => ({
            ...prev,
            [sessionId]: res
              ? {
                  state: "ok",
                  docs: asRecords(res.openDocuments),
                  hasActive: res.hasActiveDocument === true,
                }
              : { state: "error", error: "unrecognized response shape" },
          }));
        })
        .catch((error: unknown) => {
          if (!alive) return;
          setFetches((prev) => ({
            ...prev,
            [sessionId]: {
              state: "error",
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
    }
    return () => {
      alive = false;
    };
  }, [idsKey]);

  return fetches;
}

/* ── nodes ────────────────────────────────────────────────────────────────── */

function HostNode({ host }: { host: Record<string, unknown> }) {
  const connected = host.bridgeIsConnected === true;
  const lane = asLane(host.lane);
  const exePath = asString(host.executablePath);
  const agent = asRecord(host.agentRuntime);
  const disconnectReason = asString(host.disconnectReason);
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5"
      style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}
    >
      <div className="flex items-center gap-1.5">
        <LiveDot tone={connected ? "pinned" : "dangling"} lane={lane} />
        <span className="text-xs font-semibold">host</span>
        <LaneBadge lane={lane} />
      </div>
      <div className="tele text-[10px] text-muted-foreground" title={exePath}>
        {text(host.runtimeIdentity) || "∅"} · pid {text(host.processId) || "∅"}
      </div>
      <div className="tele text-[10px] text-muted-foreground">
        contracts host v{text(host.hostContractVersion) || "?"} · bridge v
        {text(host.bridgeContractVersion) || "?"} · {text(host.bridgePath) || "∅"}
      </div>
      <div className="flex flex-wrap gap-1">
        <Chip hue={connected ? "green" : "clay"}>
          bridge {connected ? "connected" : "disconnected"}
        </Chip>
        {agent && (
          <Chip hue={agent.available === true ? "slate" : "clay"}>
            agent runtime {agent.available === true ? "up" : "down"}
          </Chip>
        )}
      </div>
      {disconnectReason && <MonoNote hue="clay">{disconnectReason}</MonoNote>}
    </div>
  );
}

function DocumentLeaf({ doc }: { doc: Record<string, unknown> }) {
  const isActive = doc.isActive === true;
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 py-0.5">
      <span
        className="inline-block shrink-0 self-center"
        style={{
          width: 5,
          height: 5,
          borderRadius: 1,
          background: isActive ? "var(--pe-blue)" : "var(--line-2)",
        }}
      />
      <span
        className={`min-w-0 truncate text-xs ${isActive ? "font-medium" : "text-muted-foreground"}`}
        title={text(doc.path) || text(doc.title)}
      >
        {text(doc.title) || "∅"}
      </span>
      <span className="tele-label shrink-0 text-muted-foreground">
        {doc.isFamilyDocument === true ? "rfa" : "rvt"}
      </span>
      {isActive && <Chip hue="blue">active</Chip>}
    </div>
  );
}

function SessionNode({ session, docFetch }: { session: Record<string, unknown>; docFetch?: DocFetch }) {
  const connected = session.connected === true;
  const lane = asLane(session.lane);
  const sandboxId = asString(session.sandboxId);
  const openCount = asNumber(session.openDocumentCount);
  return (
    <div
      className="flex min-w-0 flex-col gap-1 px-3 py-2"
      style={{
        border: `0.5px solid ${connected ? "var(--line)" : "var(--line-soft)"}`,
        borderRadius: 2,
        opacity: connected ? 1 : 0.6,
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <LiveDot tone={connected ? "implicit" : "muted"} lane={lane} />
        <span className="tele min-w-0 truncate text-[11px]">{text(session.sessionId)}</span>
        <LaneBadge lane={lane} />
        {sandboxId && <Chip hue="lichen">{sandboxId}</Chip>}
        {!connected && <Chip hue="clay">disconnected</Chip>}
      </div>
      <div className="tele text-[10px] text-muted-foreground">
        pid {text(session.processId) || "∅"} · Revit {text(session.revitVersion) || "?"} ·{" "}
        {text(session.runtimeFramework) || "?"}
        {openCount !== undefined && ` · ${openCount} doc${openCount === 1 ? "" : "s"}`}
      </div>

      {/* document leaves — staged fetch, graceful in every state */}
      <div
        className="mt-0.5 flex flex-col pl-2.5"
        style={{ borderLeft: "0.5px solid var(--line-soft)" }}
      >
        {!connected && (
          <MonoNote>
            not queried — last reported doc: {asString(session.activeDocumentTitle) ?? "∅"}
          </MonoNote>
        )}
        {connected && (!docFetch || docFetch.state === "loading") && (
          <MonoNote>fetching documents…</MonoNote>
        )}
        {connected && docFetch?.state === "skipped" && (
          <MonoNote hue="kiln">not fetched — over the {DOC_FETCH_BOUND}-session bound</MonoNote>
        )}
        {connected && docFetch?.state === "error" && (
          <MonoNote hue="clay">documents unreachable: {docFetch.error}</MonoNote>
        )}
        {connected && docFetch?.state === "ok" && docFetch.docs.length === 0 && (
          <MonoNote>no documents open</MonoNote>
        )}
        {connected &&
          docFetch?.state === "ok" &&
          docFetch.docs.map((doc, i) => <DocumentLeaf key={text(doc.documentKey) || i} doc={doc} />)}
        {connected && docFetch?.state === "ok" && !docFetch.hasActive && docFetch.docs.length > 0 && (
          <MonoNote hue="kiln">no active document — open but none focused</MonoNote>
        )}
      </div>
    </div>
  );
}

/* ── the map ──────────────────────────────────────────────────────────────── */

function SessionTopologyView({ results, observedAtMs }: SyntheticViewProps) {
  const host = asRecord(results["host.status"]);
  const sessionsRes = asRecord(results["bridge.sessions.list"]);
  const sessions = sessionsRes ? asRecords(sessionsRes.sessions) : [];

  const connectedIds = sessions
    .filter((s) => s.connected === true)
    .map((s) => asString(s.sessionId))
    .filter((id): id is string => !!id);
  const docFetches = useSessionDocuments(connectedIds);

  if (!host && !sessionsRes) return <EmptyState note="unrecognized response shape" />;

  const fetched = Math.min(connectedIds.length, DOC_FETCH_BOUND);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-start">
        {/* host node */}
        <div className="w-64 shrink-0">
          {host ? <HostNode host={host} /> : <EmptyState note="host.status unavailable" />}
        </div>

        {/* trunk + session lanes */}
        <div
          className="ml-5 flex min-w-0 flex-1 flex-col gap-2.5 py-1"
          style={{ borderLeft: "0.5px solid var(--line)" }}
        >
          {sessions.length === 0 ? (
            <div className="pl-5">
              <EmptyState note="no bridge sessions — no Revit process is connected to this host" />
            </div>
          ) : (
            sessions.map((session, i) => {
              const id = asString(session.sessionId);
              return (
                <div key={id ?? i} className="relative min-w-0 pl-5">
                  {/* branch tick from trunk to session */}
                  <span
                    aria-hidden
                    className="absolute left-0 top-4 inline-block w-5"
                    style={{ borderTop: "0.5px solid var(--line)" }}
                  />
                  <SessionNode session={session} docFetch={id ? docFetches[id] : undefined} />
                </div>
              );
            })
          )}
        </div>
      </div>

      <Provenance>
        documents staged per session via revit.context.document-session · {fetched} of{" "}
        {connectedIds.length} connected sessions queried (bound {DOC_FETCH_BOUND}) · disconnected
        sessions shown from last bridge summary, not re-queried · obs{" "}
        {observedAtMs ? new Date(observedAtMs).toLocaleTimeString() : "—"}
      </Provenance>
    </div>
  );
}

export const topologyOps: SyntheticOp[] = [
  {
    key: "glance.session-topology",
    displayName: "The operator's map",
    blurb: "what machinery is alive right now and who talks to whom?",
    contractNote:
      "wants a first-class host.topology op: host identity + port + sessions + per-session documents in one snapshot (today: 2 + N calls, and SyntheticViewProps.call can't retarget session scope)",
    deps: [
      { key: "host.status" },
      { key: "bridge.sessions.list", optional: true },
    ],
    View: SessionTopologyView,
  },
];
