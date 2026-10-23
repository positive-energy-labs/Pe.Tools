/** SDK session readings at drawer and desk density. Both retain session and document keys
 * for Connectors. Lifecycle verbs and arming details stay with their owning Work. */
import { useState, type ReactNode } from "react";
import type { MachineAccess, MachineAttachmentDocument, MachineSession } from "@pe/agent-contracts";

import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { FactChip } from "@pe/kit/lang/chip";
import { useList, emptyListState } from "@pe/kit/lang/collection";
import { ListView, type ListRowParts } from "@pe/kit/lang/list-view";
import { PidChip, ShapeCells } from "./process";
import { Row } from "@pe/kit/lang/row";

import "@pe/kit/lang/lang.css";
import { TooltipHint } from "@pe/kit/lang/tooltip";

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

type TargetedDocument = MachineAttachmentDocument & {
  access: Extract<MachineAccess, { kind: "target" }>;
};

/**
 * The documents a human added to a thread here, from the host's `access` projection and nothing
 * else: no head is read in the browser. Keyed by the product socket's own document (its bridge
 * title), since an SDK document id is a different namespace and is never guessed from a title.
 */
const targetsOf = (session: MachineSession): TargetedDocument[] =>
  (session.attachment?.documents ?? []).filter(
    (document): document is TargetedDocument => document.access.kind === "target",
  );

const accessSays = (access: Exclude<MachineAccess, { kind: "read" }>) =>
  access.kind === "pea"
    ? "Pea's own Revit: Pea may write this document"
    : `you added this document to thread "${access.label}"`;

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
  const words = [...shapeWords(session), ...targetsOf(session).map((g) => g.title)];
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
            {session.row.execution?.allowed !== true ? (
              <span data-tone="caution">
                {session.row.execution?.detail ?? "Runtime ownership not verified"}
              </span>
            ) : null}
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

/** Standard parts for a held document; both the desk and standalone row use this anatomy. */
export function heldRowParts(document: SessionDocument, access?: MachineAccess): ListRowParts {
  return {
    "data-key": docKey(document),
    active: document.isActive,
    label: document.title ?? document.path,
    aside: document.isModified ? "unsaved" : undefined,
    meta:
      access && access.kind !== "read" ? (
        <>
          <TooltipHint content={accessSays(access)}>
            <span data-tone="done">{access.kind === "pea" ? "Pea's" : "in a thread"}</span>
          </TooltipHint>
          {persistenceOf(document)}
        </>
      ) : (
        persistenceOf(document)
      ),
    title: `${document.path ?? ""}${document.isModified ? " \u00b7 unsaved work" : ""}`,
  };
}

/** A desk's Revit: the frame is the socket, each document a row the cables land on. */
export function SessionCard({
  session,
  facts,
  anchor,
  verbs,
  strip,
  documentParts,
  documentDetail,
  selectedDocument,
  onDocumentPick,
  children,
}: SessionViewProps & {
  documentParts?: (document: SessionDocument) => ListRowParts;
  documentDetail?: (document: SessionDocument) => ReactNode;
  selectedDocument?: string | null;
  onDocumentPick?: (document: SessionDocument | null) => void;
  children?: ReactNode;
}) {
  const documents = session.documents;
  type Item =
    | { kind: "document"; document: SessionDocument }
    | { kind: "target"; target: TargetedDocument };
  const [state, setState] = useState(emptyListState);
  const list = useList<Item>({
    items: [
      ...(documents ?? []).map((document): Item => ({ kind: "document", document })),
      ...targetsOf(session).map((target): Item => ({ kind: "target", target })),
    ],
    keyOf: (item) =>
      item.kind === "document"
        ? docKey(item.document)
        : `target:${item.target.session}/${item.target.openId}`,
    search: (item) => ({
      text:
        item.kind === "document"
          ? [item.document.title, item.document.path]
          : [item.target.title, item.target.access.label],
    }),
    state: {
      ...state,
      ...(selectedDocument !== undefined
        ? {
            selected: selectedDocument ? [selectedDocument] : [],
            open: selectedDocument ? [selectedDocument] : [],
          }
        : {}),
    },
    onState: (next) => {
      setState(next);
      if (onDocumentPick && next.open.join() !== (selectedDocument ?? ""))
        onDocumentPick(
          (documents ?? []).find((document) => docKey(document) === next.open.at(-1)) ?? null,
        );
    },
    onPick: (item) => {
      if (item.kind === "document") {
        if (onDocumentPick)
          onDocumentPick(docKey(item.document) === selectedDocument ? null : item.document);
        else if (documentDetail)
          setState((prior) => ({
            ...prior,
            open: prior.open.includes(docKey(item.document)) ? [] : [docKey(item.document)],
          }));
      }
    },
  });
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
          {session.row.execution?.allowed !== true ? (
            <TooltipHint
              content={session.row.execution?.detail ?? "Runtime ownership not verified"}
            >
              <span data-tone="caution" className="min-w-0 truncate">
                {session.row.execution?.detail ?? "Runtime ownership not verified"}
              </span>
            </TooltipHint>
          ) : null}
        </>
      }
      headTrail={verbs}
    >
      <div className="flex flex-col py-1" aria-label="documents">
        {documents === null && targetsOf(session).length > 0 ? (
          <p role="status">
            {session.documentsLeg.error
              ? `documents unread: ${session.documentsLeg.error}`
              : "documents unknown"}
          </p>
        ) : null}
        <ListView
          list={list}
          aria-label="documents"
          bar={false}
          empty={{
            message:
              documents === null
                ? session.documentsLeg.error
                  ? `documents unread: ${session.documentsLeg.error}`
                  : "documents unknown"
                : "no document open",
            exit:
              documents === null
                ? "its documents are read once its bridge answers"
                : "open a document into it from the table",
          }}
          row={(item) =>
            item.kind === "document"
              ? (documentParts?.(item.document) ?? heldRowParts(item.document))
              : {
                  lines: 2,
                  label: item.target.title,
                  sub: item.target.access.label,
                  title: accessSays(item.target.access),
                }
          }
          detail={
            documentDetail
              ? (item) => (item.kind === "document" ? documentDetail(item.document) : null)
              : undefined
          }
        />
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
