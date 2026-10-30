/**
 * Bind a Page (opened by the Page's chip, "Bind…"): follow a thread, pin a document, or unbind.
 * The app is the human door; the Page only shows what the host resolved. Wave 1 binds the
 * `default` slot.
 */
import { useMemo } from "react";
import {
  address,
  type HarnessThreadSummary,
  type PageChoice,
  type PageTargetReading,
  targetsLabel,
} from "@pe/agent-contracts";

import { Button } from "@pe/kit/lang/button";
import { EmptyState } from "@pe/kit/lang/empty";
import { Row } from "@pe/kit/lang/row";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { emptyListState, listOf, useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Section } from "@pe/kit/lang/section";

/** One document a pin can name: saved, so it has an Address. */
export interface Pinnable {
  title: string;
  address: string | null;
  revit: string;
  ref: { session: string; openId: string };
}

/** What a write would do, in the chip's own words. */
const writeMark = (write: PageTargetReading["write"]) => (!write ? "—" : write.kind);

const subjectOf = (reading: PageTargetReading) =>
  reading.resolution.kind === "resolved"
    ? (reading.document?.title ?? "")
    : reading.resolution.kind === "choose"
      ? `choose: ${reading.resolution.reason}`
      : reading.resolution.kind;

type Choice = { kind: "thread"; thread: HarnessThreadSummary } | { kind: "doc"; doc: Pinnable };
const THREADS = "Follow a thread";
const DOCUMENTS = "Pin a document";
const keyOf = (choice: Choice) =>
  choice.kind === "thread"
    ? `thread:${choice.thread.id}`
    : `doc:${choice.doc.revit}/${choice.doc.address ?? choice.doc.title}`;
const search = (choice: Choice) => ({
  text:
    choice.kind === "thread"
      ? [choice.thread.title, targetsLabel(choice.thread.head.targets)]
      : [choice.doc.title, choice.doc.revit, choice.doc.address],
});

export function BindPicker({
  slug,
  reading,
  threads,
  documents,
  inventory,
  outcome,
  onBind,
}: {
  slug: string;
  reading: PageTargetReading | null;
  threads: readonly HarnessThreadSummary[] | null;
  documents: readonly Pinnable[] | null;
  inventory?: import("@pe/agent-contracts").Reading<unknown>;
  /** The last bind's answer: the host's refusal, or null. */
  outcome: { ok: boolean; message: string } | null;
  onBind: (slot: PageChoice) => void;
}) {
  const binding = reading?.binding ?? null;
  // Writes only documents a person added to the thread and that are open now.
  const writes = (thread: HarnessThreadSummary) =>
    thread.head.targets.some(
      (target) =>
        target.admission !== null &&
        target.request.kind === "open" &&
        documents?.some(
          (doc) =>
            target.request.kind === "open" &&
            doc.ref.session === target.request.ref.session &&
            doc.ref.openId === target.request.ref.openId,
        ),
    );
  const items = useMemo<Choice[]>(
    () => [
      ...(threads ?? []).map((thread) => ({ kind: "thread" as const, thread })),
      ...(documents ?? []).map((doc) => ({ kind: "doc" as const, doc })),
    ],
    [threads, documents],
  );
  const bound = items.find((choice) =>
    choice.kind === "thread"
      ? binding?.kind === "thread" && binding.thread === choice.thread.id
      : binding?.kind === "pinned" &&
        !!choice.doc.address &&
        binding.address.toLowerCase() === choice.doc.address.toLowerCase(),
  );
  const list = useList({
    ...(inventory ? listOf(inventory, () => items) : {}),
    // Threads have their own owner; an initial inventory read must not hide known threads.
    items,
    keyOf,
    search,
    groups: {
      of: (choice) => (choice.kind === "thread" ? THREADS : DOCUMENTS),
      order: [THREADS, DOCUMENTS],
    },
    state: { ...emptyListState(), selected: bound ? [keyOf(bound)] : [] },
    refusalOf: (choice) =>
      choice.kind === "doc" && !choice.doc.address ? "Unsaved: there is no Address to pin." : null,
    onPick: (choice) =>
      choice.kind === "thread"
        ? onBind({ kind: "thread", thread: choice.thread.id })
        : choice.doc.address && onBind({ kind: "pinned", address: address(choice.doc.address) }),
  });
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
              // I1: the bound thread by its title, never its id.
              binding?.kind === "thread"
                ? (bound?.kind === "thread" && bound.thread.title) || "a thread not listed"
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
          <p
            className={`m-0 t-small ${outcome.ok ? "text-ink-2" : ""}`}
            data-tone={outcome.ok ? undefined : "alarm"}
            role="status"
          >
            {outcome.message}{" "}
            {outcome.ok ? (
              <a href={`/pages/${encodeURIComponent(slug)}/`}>Back to the Page</a>
            ) : null}
          </p>
        ) : null}
      </Section>
      {/* One list (N3): "/" searches threads and documents together; a pick binds. */}
      <ListView
        list={list}
        aria-label="bind targets"
        empty={
          threads === null || documents === null
            ? {
                message: "reading threads and open documents",
                exit: "the host answers in a moment",
              }
            : {
                message: "no threads or open documents",
                exit: "start a thread in chat, or open a document in Revit",
              }
        }
        row={(choice) =>
          choice.kind === "thread"
            ? {
                label: choice.thread.title || "untitled thread",
                aside: targetsLabel(choice.thread.head.targets) ?? "no target",
                meta: (
                  <TooltipHint
                    content={
                      writes(choice.thread)
                        ? "The Page targets the thread's document and may write it: a person added it to the thread."
                        : "The Page targets the thread's document read-only: no person added it to the thread."
                    }
                  >
                    <span className="face-mono">{writes(choice.thread) ? "thread" : "read"}</span>
                  </TooltipHint>
                ),
              }
            : {
                label: choice.doc.title,
                aside: choice.doc.revit,
                title:
                  "A pin names a saved file, so it survives a reopen. It writes only to Pea's own documents.",
              }
        }
      />
    </div>
  );
}
