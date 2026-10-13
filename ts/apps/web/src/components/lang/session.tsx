/**
 * One Revit, as the SDK census reports it, in two densities over one reading: `SessionRow` for a
 * drawer or a list (a two-line `Row`: year and name, pid and phase, the active document and the
 * shape), `SessionCard` for a desk (an `ArtifactFrame`: the same head, one `Row` per document, the
 * shape in the foot). Both take the verbs and the arming strip as slots (`useLifecycle` in
 * `open/lifecycle.tsx` makes them), so the kit knows nothing of the instances Work. Anchors for a
 * `Connectors` overlay: the card and the row carry `data-key` = `anchor` (the session's key), each
 * document row `doc:<openId>`. A desk adds its own rows (a free socket) through `children`.
 */
import type { ReactNode } from "react";
import type { MachineSession } from "@pe/agent-contracts";

import { ArtifactFrame } from "./artifact-frame";
import { FactChip } from "./chip";
import { EmptyState } from "./empty";
import { PidChip, ShapeCells } from "./process";
import { Row } from "./row";

import "./lang.css";

type Phase = "ready" | "booting" | "no add-in" | "unresponsive" | "gone" | "failed";

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
}

const CUSTODY_SAYS = {
  controlled: "pe-revit holds its receipt: full lifecycle",
  observed: "no receipt yet: read by pid; the first open or stop adopts it",
};

const ICON_STARTED = "started from the Revit icon";

const persistenceOf = (document: NonNullable<MachineSession["documents"]>[number]) =>
  document.persistence === null
    ? "persistence unknown"
    : document.persistence === "cloud"
      ? "cloud"
      : "local";

const docKey = (document: NonNullable<MachineSession["documents"]>[number]) =>
  `doc:${document.openId ?? document.path}`;

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
  const words = shapeWords(session);
  return (
    <div className="flex flex-col" data-key={anchor} aria-label={`Revit ${facts.year}`}>
      <Row
        lines={2}
        label={`Revit ${facts.year}`}
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

/** A desk's Revit: the frame is the socket, each document a row the cables land on. */
export function SessionCard({
  session,
  facts,
  anchor,
  verbs,
  strip,
  children,
}: SessionViewProps & { children?: ReactNode }) {
  const documents = session.documents;
  return (
    <ArtifactFrame
      data-key={anchor}
      label={`Revit ${facts.year} ${facts.name ?? ICON_STARTED}`}
      head={
        <>
          <span className="t-small t-upper">Revit {facts.year}</span>
          {facts.name ? (
            <FactChip title="the session name pe-revit addresses it by">{facts.name}</FactChip>
          ) : (
            <span>{ICON_STARTED}</span>
          )}
          {facts.pid ? <PidChip pid={facts.pid} /> : null}
          <PhaseWord facts={facts} />
          <span title={CUSTODY_SAYS[facts.custody]}>{facts.custody}</span>
        </>
      }
      headTrail={verbs}
      foot={<ShapeCells shape={session.row.shape} />}
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
          documents.map((document) => (
            <Row
              key={docKey(document)}
              data-key={docKey(document)}
              active={document.isActive}
              label={document.title ?? document.path}
              aside={document.isModified ? "unsaved" : undefined}
              meta={persistenceOf(document)}
              title={`${document.path ?? ""}${document.isModified ? " · unsaved work" : ""}`}
            />
          ))
        )}
        {children}
      </div>
      {strip}
    </ArtifactFrame>
  );
}
