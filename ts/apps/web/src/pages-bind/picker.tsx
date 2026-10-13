/**
 * Bind a Page (opened by the Page's chip, "Bind…"): follow a thread, pin a document, or unbind.
 * The app is the human door; the Page only shows what the host resolved. Wave 1 binds the
 * `default` slot.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  address,
  type HarnessThreadSummary,
  type PageSlot,
  type PageTargetReading,
} from "@pe/agent-contracts";

import { Button } from "#/components/lang/button";
import { EmptyState } from "#/components/lang/empty";
import { Row } from "#/components/lang/row";
import { Section } from "#/components/lang/section";
import { Surface } from "#/components/lang/surface";
import { useThreadSummaries } from "#/open/bay";
import { inventoryOf, previousOf, useInventory } from "#/readings";

import { bindPage, readPageTarget } from "./client";

/** One document a pin can name: saved, so it has an Address. */
export interface Pinnable {
  title: string;
  address: string | null;
  revit: string;
}

/** What a write would do, in the chip's own words. */
export const writeMark = (write: PageTargetReading["write"]) =>
  !write ? "—" : write.kind === "rw" ? "rw" : write.kind;

const subjectOf = (reading: PageTargetReading) =>
  reading.resolution.kind === "resolved"
    ? (reading.document?.title ?? "")
    : reading.resolution.kind === "choose"
      ? `choose: ${reading.resolution.reason}`
      : reading.resolution.kind;

export function BindPicker({
  slug,
  reading,
  threads,
  documents,
  outcome,
  onBind,
}: {
  slug: string;
  reading: PageTargetReading | null;
  threads: readonly HarnessThreadSummary[] | null;
  documents: readonly Pinnable[] | null;
  /** The last bind's answer: the host's refusal, or null. */
  outcome: { ok: boolean; message: string } | null;
  onBind: (slot: PageSlot) => void;
}) {
  const binding = reading?.binding ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="pages-bind">
      <Section
        label={`Bind ${reading?.page ?? slug}`}
        aside={
          <Button
            label="Unbind"
            kind="framed"
            refusal={binding?.kind === "none" ? "This Page is not bound." : null}
            onClick={() => onBind({ kind: "none" })}
          />
        }
      >
        {reading ? (
          <Row
            label={subjectOf(reading) || "no document"}
            aside={
              binding?.kind === "thread"
                ? `thread ${binding.thread.slice(0, 8)}`
                : (binding?.kind ?? "")
            }
            meta={<span className="face-mono">{writeMark(reading.write)}</span>}
            title={reading.write?.kind === "read" ? reading.write.refusal.reason : undefined}
          />
        ) : (
          <EmptyState story="scope" exit="reading the Page's binding from the host">
            no reading yet
          </EmptyState>
        )}
        {outcome ? (
          <p className={`m-0 t-small ${outcome.ok ? "text-ink-2" : "text-alarm"}`} role="status">
            {outcome.message}{" "}
            {outcome.ok ? (
              <a href={`/pages/${encodeURIComponent(slug)}/`}>Back to the Page</a>
            ) : null}
          </p>
        ) : null}
      </Section>
      <Section label="Follow a thread">
        <p className="m-0 t-small text-ink-2">
          The Page targets whatever the thread points at, and writes only while that thread holds
          rw.
        </p>
        {threads === null ? (
          <EmptyState story="scope" exit="reading threads">
            no threads read yet
          </EmptyState>
        ) : threads.length === 0 ? (
          <EmptyState story="scope" exit="start a thread in chat, then bind to it">
            no threads
          </EmptyState>
        ) : (
          threads.map((thread) => (
            <Row
              key={thread.id}
              label={thread.title || thread.id}
              aside={thread.head.displayLabel ?? "no target"}
              meta={
                <span className="face-mono">
                  {thread.head.grant && !thread.head.grant.revoked ? "rw" : "read"}
                </span>
              }
              active={binding?.kind === "thread" && binding.thread === thread.id}
              onClick={() => onBind({ kind: "thread", thread: thread.id })}
            />
          ))
        )}
      </Section>
      <Section label="Pin a document">
        <p className="m-0 t-small text-ink-2">
          A pin names a saved file, so it survives a reopen. It writes only to Pea's own documents.
        </p>
        {documents === null ? (
          <EmptyState story="scope" exit="reading open documents">
            no documents read yet
          </EmptyState>
        ) : documents.length === 0 ? (
          <EmptyState story="scope" exit="open a document in Revit, then pin it">
            no open documents
          </EmptyState>
        ) : (
          documents.map((doc) => (
            <Row
              key={`${doc.revit}/${doc.address ?? doc.title}`}
              label={doc.title}
              aside={doc.revit}
              refusal={doc.address ? null : "Unsaved: there is no Address to pin."}
              active={
                binding?.kind === "pinned" &&
                !!doc.address &&
                binding.address.toLowerCase() === doc.address.toLowerCase()
              }
              onClick={() =>
                doc.address && onBind({ kind: "pinned", address: address(doc.address) })
              }
            />
          ))
        )}
      </Section>
    </div>
  );
}

/** The route body: the live threads, the open documents, and the host's reading of the Page. */
export function BindRoute({ slug }: { slug: string }) {
  const [reading, setReading] = useState<PageTargetReading | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const threads = useThreadSummaries(true, null);
  const inventory = useInventory(true);
  const seen = previousOf(inventory);
  const documents = useMemo<Pinnable[] | null>(
    () =>
      seen
        ? inventoryOf(seen.sessions).flatMap((session) =>
            (session.openDocuments ?? []).map((doc) => ({
              title: doc.title,
              address: doc.address ?? null,
              revit: `Revit ${session.year ?? ""} · pid ${session.processId}`.replace("  ", " "),
            })),
          )
        : null,
    [seen],
  );
  const read = useCallback(
    () =>
      readPageTarget(slug).then(setReading, (error: Error) =>
        setOutcome({ ok: false, message: error.message }),
      ),
    [slug],
  );
  useEffect(() => void read(), [read]);
  const onBind = (slot: PageSlot) =>
    void bindPage(slug, slot).then(
      (next) => {
        setReading(next);
        setOutcome({ ok: true, message: "Bound. The Page's chip follows within 5 s." });
      },
      (error: Error) => setOutcome({ ok: false, message: error.message }),
    );
  return (
    <Surface>
      <BindPicker
        slug={slug}
        reading={reading}
        threads={threads}
        documents={documents}
        outcome={outcome}
        onBind={onBind}
      />
    </Surface>
  );
}
