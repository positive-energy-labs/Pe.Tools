import { useEffect, useState } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance } from "#/components/lang/section";
import { callHostDynamic } from "#/host/client";
import type { Lane } from "#/host/target";
import { LaneBadge, LiveDot } from "#/host/target-ui";
import { UnrecognizedShape, asNumber, asRecord, asRecords, asString, text } from "#/ops/registry";
import type { SyntheticOp, SyntheticViewProps } from "#/ops/synthetic";

/**
 * glance.session-topology — the operator's map. Host process on the left,
 * bridge sessions laned off it, open documents as leaves. Every edge is a
 * hairline; every measured value is mono; dead sessions stay visible, muted.
 */

const DOC_FETCH_BOUND = 12;

// The SDK's lane union, verbatim: payload SOURCE only. A value outside it is not a lane, and
// renders as no lane badge rather than an invented "unknown" one.
function asLane(value: unknown): Lane | null {
  return value === "dev" || value === "installed" ? value : null;
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
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line-2 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <LiveDot tone={connected ? "pinned" : "dangling"} lane={lane} />
        <span className="t-value font-medium">host</span>
        {lane ? <LaneBadge lane={lane} /> : null}
      </div>
      <div className="face-mono t-caption text-ink-2" title={exePath}>
        {text(host.runtimeIdentity) || "∅"} · pid {text(host.processId) || "∅"}
      </div>
      <div className="face-mono t-caption text-ink-2">
        contracts host v{text(host.hostContractVersion) || "?"} · bridge v
        {text(host.bridgeContractVersion) || "?"} · {text(host.bridgePath) || "∅"}
      </div>
      <div className="flex flex-wrap gap-1">
        <FactChip
          tone={connected ? "done" : "caution"}
          title={connected ? "the Revit bridge is up" : "the bridge is down — caution, not alarm"}
        >
          bridge {connected ? "connected" : "disconnected"}
        </FactChip>
        {agent && (
          <FactChip
            tone={agent.available === true ? "meta" : "caution"}
            title="in-process agent runtime availability"
          >
            agent runtime {agent.available === true ? "up" : "down"}
          </FactChip>
        )}
      </div>
      {disconnectReason && (
        <span className="face-mono t-caption text-caution">{disconnectReason}</span>
      )}
    </div>
  );
}

function DocumentLeaf({ doc }: { doc: Record<string, unknown> }) {
  const isActive = doc.isActive === true;
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 py-0.5">
      {/* the active mark is neutral ink (R13a's locate mark) — never a hue. */}
      <span
        className={`inline-block size-[5px] shrink-0 self-center rounded-[1px] ${isActive ? "bg-ink" : "bg-line-2"}`}
      />
      <span
        className={`t-value min-w-0 truncate ${isActive ? "font-medium" : "text-ink-2"}`}
        title={text(doc.path) || text(doc.title)}
      >
        {text(doc.title) || "∅"}
      </span>
      <span className="face-mono t-caption shrink-0 text-ink-2">
        {doc.isFamilyDocument === true ? "rfa" : "rvt"}
      </span>
      {isActive && <FactChip title="this document has focus in Revit">active</FactChip>}
    </div>
  );
}

function SessionNode({
  session,
  docFetch,
}: {
  session: Record<string, unknown>;
  docFetch?: DocFetch;
}) {
  const connected = session.connected === true;
  const lane = asLane(session.lane);
  const sdkSessionId = asString(session.sdkSessionId);
  const custody = asString(session.custody);
  const openCount = asNumber(session.openDocumentCount);
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2 ${connected ? "border-line" : "border-line opacity-60"}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <LiveDot tone={connected ? "implicit" : "muted"} lane={lane} />
        <span className="face-mono t-label min-w-0 truncate">{text(session.sessionId)}</span>
        {lane ? <LaneBadge lane={lane} /> : null}
        {custody && (
          <FactChip
            title={
              custody === "controlled"
                ? "pe-revit holds this session's registry receipt and owns its lifecycle"
                : "pe-revit holds no receipt for this session; it can read status and documents only"
            }
          >
            {custody}
          </FactChip>
        )}
        {sdkSessionId && <FactChip title="pe-revit session id">{sdkSessionId}</FactChip>}
        {!connected && (
          <FactChip tone="caution" title="last seen by the bridge; not reachable now">
            disconnected
          </FactChip>
        )}
      </div>
      <div className="face-mono t-caption text-ink-2">
        pid {text(session.processId) || "∅"} · Revit {text(session.revitVersion) || "?"} ·{" "}
        {text(session.runtimeFramework) || "?"}
        {openCount !== undefined && ` · ${openCount} doc${openCount === 1 ? "" : "s"}`}
      </div>

      {/* document leaves — staged fetch, graceful in every state */}
      <div className="mt-0.5 flex flex-col border-l border-line pl-2.5">
        {!connected && (
          <span className="face-mono t-caption text-ink-2">
            not queried — last reported doc: {asString(session.activeDocumentTitle) ?? "∅"}
          </span>
        )}
        {connected && (!docFetch || docFetch.state === "loading") && (
          <span className="face-mono t-caption text-ink-2">fetching documents…</span>
        )}
        {connected && docFetch?.state === "skipped" && (
          <span className="face-mono t-caption text-caution">
            not fetched — over the {DOC_FETCH_BOUND}-session bound
          </span>
        )}
        {connected && docFetch?.state === "error" && (
          <span className="face-mono t-caption text-caution">
            documents unreachable: {docFetch.error}
          </span>
        )}
        {connected && docFetch?.state === "ok" && docFetch.docs.length === 0 && (
          <span className="face-mono t-caption text-ink-2">no documents open</span>
        )}
        {connected &&
          docFetch?.state === "ok" &&
          docFetch.docs.map((doc, i) => (
            <DocumentLeaf key={text(doc.documentKey) || i} doc={doc} />
          ))}
        {connected &&
          docFetch?.state === "ok" &&
          !docFetch.hasActive &&
          docFetch.docs.length > 0 && (
            <span className="face-mono t-caption text-caution">
              no active document — open but none focused
            </span>
          )}
      </div>
    </div>
  );
}

/* ── the map ──────────────────────────────────────────────────────────────── */

function SessionTopologyView({ results, observedAtMs }: SyntheticViewProps) {
  const topology = asRecord(results["host.topology"]);
  const host = topology ? asRecord(topology.host) : undefined;
  const sessions = topology ? asRecords(topology.sessions) : [];
  const observedAtUtc = topology ? asString(topology.observedAtUtc) : undefined;

  const connectedIds = sessions
    .filter((s) => s.connected === true)
    .map((s) => asString(s.sessionId))
    .filter((id): id is string => !!id);
  const docFetches = useSessionDocuments(connectedIds);

  if (!topology) return <UnrecognizedShape />;

  const fetched = Math.min(connectedIds.length, DOC_FETCH_BOUND);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-start">
        {/* host node */}
        <div className="w-64 shrink-0">
          {host ? (
            <HostNode host={host} />
          ) : (
            <EmptyState story="scope" exit="is the host process running?">
              host.status unavailable
            </EmptyState>
          )}
        </div>

        {/* trunk + session lanes */}
        <div className="ml-5 flex min-w-0 flex-1 flex-col gap-2.5 border-l border-line py-1">
          {sessions.length === 0 ? (
            <div className="pl-5">
              <EmptyState story="scope" exit="start a Revit process with the bridge add-in loaded">
                no bridge sessions — no Revit process is connected to this host
              </EmptyState>
            </div>
          ) : (
            sessions.map((session, i) => {
              const id = asString(session.sessionId);
              return (
                <div key={id ?? i} className="relative min-w-0 pl-5">
                  {/* branch tick from trunk to session */}
                  <span
                    aria-hidden
                    className="absolute left-0 top-4 inline-block w-5 border-t border-line"
                  />
                  <SessionNode session={session} docFetch={id ? docFetches[id] : undefined} />
                </div>
              );
            })
          )}
        </div>
      </div>

      <Provenance>
        host + sessions from one host.topology snapshot · obs{" "}
        {observedAtUtc
          ? new Date(observedAtUtc).toLocaleTimeString()
          : observedAtMs
            ? new Date(observedAtMs).toLocaleTimeString()
            : "—"}{" "}
        (host clock) · documents staged per session via revit.context.document-session · {fetched}{" "}
        of {connectedIds.length} connected sessions queried (bound {DOC_FETCH_BOUND}) · disconnected
        sessions shown from last bridge summary, not re-queried
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
      "host.topology landed (ADR 0003): host identity + sessions in one snapshot. Still client-staged: per-session documents (1 + N calls) — the contract doesn't carry them yet, nor the host's own port/baseUrl.",
    deps: [{ key: "host.topology" }],
    View: SessionTopologyView,
  },
];
