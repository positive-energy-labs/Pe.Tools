/**
 * One Revit, as the SDK census reports it, in two densities over one reading: `SessionRow` for a
 * drawer or a list (a two-line `Row`: year and name, pid and phase, the active document and the
 * shape), `SessionCard` for a desk (an `ArtifactFrame`: the same head, one `Row` per document, the
 * shape in the foot). Both take the verbs and the arming strip as slots (`useLifecycle` in
 * `open/lifecycle.tsx` makes them), so the kit knows nothing of the instances Work. Anchors for a
 * `Connectors` overlay: the card and the row carry `data-key` = `anchor` (the session's key), each
 * document row `doc:<openId>`. A desk adds its own rows (a free socket) through `children`, and may
 * draw each document itself through `documentRow` (a `HeldRow` with verbs and a strip).
 */
import type { ReactNode } from "react";
import type {
  MachineAccess,
  MachineAttachmentDocument,
  MachineSession,
} from "@pe/agent-contracts";

import { ArtifactFrame } from "./artifact-frame";
import { FactChip } from "./chip";
import { EmptyState } from "./empty";
import { PidChip, ShapeCells } from "./process";
import { Row } from "./row";

import "./lang.css";

type Phase = "ready" | "booting" | "no add-in" | "unresponsive" | "gone" | "failed";

export type SessionDocument = NonNullable<MachineSession["documents"]>[number];

/** What the kit reads of a session; the machine layer derives it from the SDK row once. */
export interface SessionFacts {
  year: number;
  /** The session name, or null for a Revit started from its icon (observed, no name). */
  name: string | null;
  pid: number | null;
  phase: Phase;
  phaseTone: "caution" | "alarm" | undefined;
  custody: "controlled" | "observed";
  /** A modal dialog is open in it. */
  dialog: boolean;
  /** Pea's background Revit; absent, the person's own. */
  whose?: "pea";
}

const CUSTODY_SAYS = {
  controlled: "pe-revit holds its receipt: full lifecycle",
  observed: "no receipt yet: read by pid; the first open or stop adopts it",
};

const ICON_STARTED = "started from the Revit icon";

const persistenceOf = (document: SessionDocument) =>
  document.persistence === null
    ? "persistence unknown"
    : document.persistence === "cloud"
      ? "cloud"
      : "local";

type GrantedDocument = MachineAttachmentDocument & {
  access: Extract<MachineAccess, { via: "grant" }>;
};

/**
 * The documents a thread may write here, from the host's `access` projection and nothing else:
 * no head is read in the browser. Keyed by the product socket's own document (its bridge title),
 * since an SDK document id is a different namespace and is never guessed from a title.
 */
export const grantsOf = (session: MachineSession): GrantedDocument[] =>
  (session.attachment?.documents ?? []).filter(
    (document): document is GrantedDocument =>
      document.access.level === "rw" && document.access.via === "grant",
  );

const rwSays = (access: Extract<MachineAccess, { level: "rw" }>) =>
  access.via === "pea-session"
    ? "Pea's own Revit: Pea may write this document"
    : `thread "${access.threadTitle}" may write this document until ${until(access.expiresAt)}`;

const until = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The `Connectors` anchor of one held document. */
export const docKey = (document: SessionDocument) => `doc:${document.openId ?? document.path}`;

function shapeWords(session: MachineSession) {
  const shape = session.row.shape;
  return [
    shape.payload === "checkout" ? "checkout" : null,
    shape.reload === "hot" ? "hot reload" : null,
    shape.posture === "background" ? "background" : null,
    shape.quarantine ? "add-ins off" : null,
  ].filter(Boolean) as string[];
}

function PhaseWord({ facts }: { facts: SessionFacts }) {
  return (
    <>
      <span data-tone={facts.phaseTone}>{facts.phase}</span>
      {facts.dialog ? <span data-tone="caution">dialog open</span> : null}
    </>
  );
}

const titleOf = (facts: SessionFacts) =>
  facts.whose === "pea" ? `Pea's Revit ${facts.year}` : `Revit ${facts.year}`;

interface SessionViewProps {
  session: MachineSession;
  facts: SessionFacts;
  /** The session's key, as the `data-key` anchor. */
  anchor: string;
  /** The lifecycle verbs (hr, open here, stop). */
  verbs?: ReactNode;
  /** The arming strip a verb opened, drawn under the row or inside the card. */
  strip?: ReactNode;
}

/** A drawer's or a list's Revit: two item heights, verbs in the trailing slot on hover. */
export function SessionRow({ session, facts, anchor, verbs, strip }: SessionViewProps) {
  const documents = session.documents;
  const active = documents?.find((document) => document.isActive) ?? documents?.[0];
  const words = [...shapeWords(session), ...grantsOf(session).map((g) => `rw · ${g.title}`)];
  return (
    <div className="flex flex-col" data-key={anchor} aria-label={titleOf(facts)}>
      <Row
        lines={2}
        label={<span data-tone={facts.whose}>{titleOf(facts)}</span>}
        aside={facts.name ? <span className="face-mono">{facts.name}</span> : ICON_STARTED}
        meta={
          <>
            {facts.pid ? <PidChip pid={facts.pid} /> : null}
            <PhaseWord facts={facts} />
          </>
        }
        sub={
          <>
            {documents === null
              ? "documents unknown"
              : active
                ? `${active.title ?? active.path}${active.isModified ? " · unsaved" : ""}${
                    documents.length > 1 ? ` +${documents.length - 1}` : ""
                  }`
                : "no document open"}
            {words.length ? ` · ${words.join(", ")}` : ""}
          </>
        }
        actions={verbs}
      />
      {strip}
    </div>
  );
}

/** A held document as a desk card's row: the cable lands on it; a desk adds verbs and a strip. */
export function HeldRow({
  document,
  access,
  active,
  verbs,
  strip,
  onClick,
}: {
  document: SessionDocument;
  /** What the host says may write it; only `rw` is drawn. */
  access?: MachineAccess;
  /** The row a cable was pressed on (not Revit's active document, which is its own mark). */
  active?: boolean;
  verbs?: ReactNode;
  strip?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <>
      <Row
        data-key={docKey(document)}
        active={document.isActive}
        selected={active}
        label={document.title ?? document.path}
        aside={document.isModified ? "unsaved" : undefined}
        meta={
          access?.level === "rw" ? (
            <>
              <span data-tone="done" title={rwSays(access)}>
                rw
              </span>
              {persistenceOf(document)}
            </>
          ) : (
            persistenceOf(document)
          )
        }
        actions={verbs}
        title={`${document.path ?? ""}${document.isModified ? " · unsaved work" : ""}`}
        onClick={onClick}
      />
      {strip}
    </>
  );
}

/** A desk's Revit: the frame is the socket, each document a row the cables land on. */
export function SessionCard({
  session,
  facts,
  anchor,
  verbs,
  strip,
  documentRow,
  children,
}: SessionViewProps & {
  /** Draw one held document (a `HeldRow` with the desk's verbs); absent, the plain row. */
  documentRow?: (document: SessionDocument) => ReactNode;
  children?: ReactNode;
}) {
  const documents = session.documents;
  return (
    <ArtifactFrame
      data-key={anchor}
      label={`${titleOf(facts)} ${facts.name ?? ICON_STARTED}`}
      head={
        <>
          <span className="t-small t-upper" data-tone={facts.whose}>
            {titleOf(facts)}
          </span>
          <PhaseWord facts={facts} />
        </>
      }
      headTrail={verbs}
    >
      <div className="flex flex-col py-1" aria-label="documents">
        {documents === null ? (
          <Row
            label={
              <EmptyState story="scope" exit="its documents are read once its bridge answers">
                {session.documentsLeg.error
                  ? `documents unread: ${session.documentsLeg.error}`
                  : "documents unknown"}
              </EmptyState>
            }
          />
        ) : documents.length === 0 ? (
          <Row
            label={
              <EmptyState story="scope" exit="open a document into it from the table">
                no document open
              </EmptyState>
            }
          />
        ) : (
          documents.map((document) =>
            documentRow ? (
              <div key={docKey(document)} className="contents">
                {documentRow(document)}
              </div>
            ) : (
              <HeldRow key={docKey(document)} document={document} />
            ),
          )
        )}
        {grantsOf(session).map((granted) => (
          <Row
            key={`rw:${granted.session}/${granted.openId}`}
            lines={2}
            label={<span data-tone="done">rw · {granted.title}</span>}
            meta={`until ${until(granted.access.expiresAt)}`}
            sub={granted.access.threadTitle}
            title={rwSays(granted.access)}
          />
        ))}
        {children}
      </div>
      {/* The machine facts wrap (a desk card is narrow); a rail would clip them. */}
      <div className="flex flex-wrap items-center gap-1 px-(--gutter) pb-1 hairline-t pt-1">
        {facts.name ? (
          <FactChip title="the session name pe-revit addresses it by">{facts.name}</FactChip>
        ) : (
          <span>{ICON_STARTED}</span>
        )}
        {facts.pid ? <PidChip pid={facts.pid} /> : null}
        <FactChip title={CUSTODY_SAYS[facts.custody]}>{facts.custody}</FactChip>
        <ShapeCells shape={session.row.shape} />
      </div>
      {strip}
    </ArtifactFrame>
  );
}
