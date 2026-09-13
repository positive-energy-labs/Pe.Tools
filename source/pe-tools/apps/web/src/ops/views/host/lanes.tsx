import { token } from "#/lib/token";
import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import type { Lane } from "#/readings";
import { DeployBadge, LiveDot } from "#/host/target-ui";
import { KVGrid } from "#/ops/primitives";
import {
  asArray,
  asNumber,
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  UnrecognizedShape,
} from "#/ops/registry";

export const LANES: readonly Lane[] = ["dev", "installed"];

export function laneOf(value: unknown): Lane | null {
  return LANES.find((lane) => lane === value) ?? null;
}

export function MonoAside({ children }: { children: ReactNode }) {
  return <span className="">{children}</span>;
}

export function HostStatusView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const connected = rec.bridgeIsConnected === true;
  const disconnectReason = asString(rec.disconnectReason);
  const agentRuntime = asRecord(rec.agentRuntime);
  return (
    <Section
      label="host"
      aside={
        <span>
          <LiveDot tone="implicit" lane={connected ? "dev" : null} />
          <FactChip
            tone={connected ? "done" : "caution"}
            title={
              connected
                ? "the Revit bridge is connected"
                : "a busy bridge is not the model disagreeing — caution, not alarm"
            }
          >
            {connected ? "bridge connected" : "bridge down"}
          </FactChip>
        </span>
      }
    >
      <KVGrid
        columns={3}
        items={[
          { label: "lane", value: asString(rec.lane) ?? "∅" },
          { label: "service", value: asString(rec.serviceName) ?? "∅" },
          { label: "pid", value: asNumber(rec.processId)?.toString() ?? "∅" },
          { label: "runtime", value: asString(rec.runtimeIdentity) ?? "∅" },
          {
            label: "contracts",
            value: `bridge v${asNumber(rec.bridgeContractVersion) ?? "?"} · host v${asNumber(rec.hostContractVersion) ?? "?"}`,
          },
          { label: "source root", value: asString(rec.sourceRoot) ?? "∅" },
        ]}
      />
      {!connected && disconnectReason && (
        <Provenance>
          <span style={{ color: token("caution") }}>disconnect: {disconnectReason}</span>
        </Provenance>
      )}
      {agentRuntime && agentRuntime.available !== true && (
        <Provenance>
          agent runtime unavailable
          {asString(agentRuntime.error)
            ? ` — ${asString(agentRuntime.error)}`
            : " (not yet settled)"}
        </Provenance>
      )}
    </Section>
  );
}

export function SessionRow({
  connected,
  lane,
  title,
  processId,
  sessionId,
  revitVersion,
  openDocumentCount,
}: {
  connected: boolean;
  lane: Lane | null;
  title: string | undefined;
  processId: number | undefined;
  sessionId: string | undefined;
  revitVersion: string | undefined;
  openDocumentCount: number | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
      <LiveDot tone={connected ? "implicit" : "dangling"} lane={lane} />
      {lane ? <DeployBadge lane={lane} /> : null}
      <span className="min-w-0 truncate" title={title}>
        {title ?? <span className="">no active document</span>}
      </span>
      <span className="ml-auto shrink-0">
        {revitVersion ? `revit ${revitVersion}` : "revit ∅"} · {openDocumentCount ?? 0} doc
        {openDocumentCount === 1 ? "" : "s"}
      </span>
      <span className="shrink-0" title={sessionId}>
        pid {processId ?? "∅"} · {sessionId ? `${sessionId.slice(0, 8)}…` : "∅"}
      </span>
    </div>
  );
}

export function sessionListFrame(children: ReactNode) {
  return <div className="">{children}</div>;
}

export function BridgeSessionsListView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const sessions = asRecords(rec.sessions);
  return (
    <Section label="sessions" aside={<MonoAside>{sessions.length} connected</MonoAside>}>
      {sessions.length === 0 ? (
        <EmptyState story="scope" exit="start a Revit session with the bridge add-in loaded">
          no revit connected
        </EmptyState>
      ) : (
        sessionListFrame(
          sessions.map((s, i) => (
            <SessionRow
              key={asString(s.sessionId) ?? String(i)}
              connected={s.connected === true}
              lane={laneOf(s.lane)}
              title={asString(s.activeDocumentTitle)}
              processId={asNumber(s.processId)}
              sessionId={asString(s.sessionId)}
              revitVersion={asString(s.revitVersion)}
              openDocumentCount={asNumber(s.openDocumentCount)}
            />
          )),
        )
      )}
    </Section>
  );
}

export function BridgeSessionSummaryView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const connected = rec.bridgeIsConnected === true;
  const activeDocument = asRecord(rec.activeDocument);
  if (!connected)
    return (
      <EmptyState story="scope" exit="start a Revit session with the bridge add-in loaded">
        no revit connected
      </EmptyState>
    );
  const observedAt = asNumber(activeDocument?.observedAtUnixMs);
  return (
    <Section label="session">
      {sessionListFrame(
        <SessionRow
          connected={connected}
          lane={laneOf(rec.lane)}
          title={asString(activeDocument?.title)}
          processId={asNumber(rec.processId)}
          sessionId={asString(rec.sessionId)}
          revitVersion={asString(rec.revitVersion)}
          openDocumentCount={asNumber(rec.openDocumentCount)}
        />,
      )}
      <Provenance>
        {asString(rec.runtimeFramework) ?? "framework ∅"}
        {asString(rec.buildStamp) ? ` · build ${asString(rec.buildStamp)}` : ""}
        {observedAt ? ` · doc observed ${new Date(observedAt).toISOString()}` : ""}
      </Provenance>
    </Section>
  );
}

export const LOG_TIMESTAMP = /^(\[?\d{4}-\d{2}-\d{2}[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?\s*)/;

export function logLineColor(line: string): string | undefined {
  if (/\b(error|err|fatal)\b/i.test(line)) return token("caution");
  if (/\bwarn(ing)?\b/i.test(line)) return token("caution");
  return undefined;
}

export function LogLine({ line }: { line: string }) {
  const match = line.match(LOG_TIMESTAMP);
  const timestamp = match?.[1] ?? "";
  const rest = timestamp ? line.slice(timestamp.length) : line;
  return (
    <div className="whitespace-pre">
      {timestamp && <span className="">{timestamp}</span>}
      <span style={{ color: logLineColor(rest) }}>{rest}</span>
    </div>
  );
}

export function scrollToBottom(el: HTMLDivElement | null) {
  if (el) el.scrollTop = el.scrollHeight;
}

export function LogsTailView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const files = asRecords(rec.files);
  if (files.length === 0)
    return (
      <EmptyState story="scope" exit="name at least one log file in the request">
        no log files in response
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-4">
      {files.map((file, i) => {
        const lines = asArray(file.lines).flatMap((line) =>
          typeof line === "string" ? [line] : [],
        );
        return (
          <Section
            key={asString(file.label) ?? String(i)}
            label={asString(file.label) ?? `log ${i}`}
            aside={<MonoAside>{lines.length} lines</MonoAside>}
          >
            {lines.length === 0 ? (
              <EmptyState story="scope" exit="nothing has logged here yet — check the path">
                log empty or unreadable
              </EmptyState>
            ) : (
              <div ref={scrollToBottom} className="max-h-[18rem] overflow-auto px-2 py-1">
                {lines.map((line, index) => (
                  <LogLine key={index} line={line} />
                ))}
              </div>
            )}
            <Provenance>
              {asString(file.filePath) ?? "path ∅"} · tail only, older lines not fetched
            </Provenance>
          </Section>
        );
      })}
    </div>
  );
}
