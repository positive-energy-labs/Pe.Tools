/**
 * Element ids Pea writes in a turn's prose, linked only to what the host pinned for that turn. One
 * `turn.element-names` read per settled turn; the host derives the exact documents itself, so the
 * web sends ids, never targets. The answer freezes per turn: an id links only when it resolved to
 * exactly one element and every target pinned (`complete`); anything else stays plain text.
 */
import {
  TURN_ELEMENT_NAMES_LIMIT,
  type TurnElementNamesObservation,
  type TurnElementNamesRequest,
} from "@pe/agent-contracts";
import type { ChatMessage } from "@pe/agent-contracts/chat-state";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import {
  proseIds,
  SubjectText,
  subjectDocument,
  type NumberedElement,
} from "@pe/kit/lang/subject-text";
import { useEffect, useState } from "react";
import { resolveWorkbenchConfig } from "./config";
import { harnessClient } from "./provider/harness-client";

/** A linked id: the exact document it resolved in (an attention doc) and its number in the turn. */
export type TurnSubject = NumberedElement & { doc: string };
export type TurnSubjects = ReadonlyMap<number, TurnSubject>;
const NONE: TurnSubjects = new Map();

/** Resolved-to-one entries of a complete snapshot, numbered by first appearance in the prose. */
function linkedSubjects(observation: TurnElementNamesObservation, text: string) {
  if (!observation.snapshot.complete) return NONE;
  const resolved = new Map(
    observation.entries.flatMap((entry) =>
      entry.state === "resolved" ? [[entry.elementId, entry] as const] : [],
    ),
  );
  const subjects = new Map<number, TurnSubject>();
  for (const id of proseIds(text)) {
    const entry = resolved.get(id);
    if (!entry || subjects.has(id)) continue;
    // The attention doc every route scopes a document by: `session/openId`.
    const doc = `${entry.target.session}/${entry.target.openId}`;
    subjects.set(id, { id, name: entry.name, number: subjects.size + 1, doc });
  }
  return subjects;
}

type Read = (body: TurnElementNamesRequest) => Promise<TurnElementNamesObservation>;
const read: Read = (body) => harnessClient(resolveWorkbenchConfig().origin).turnElementNames(body);
// ponytail: session-lifetime cache, one entry per (thread, turn); a failed read freezes as plain
// text until reload, the same as an unresolved answer.
const turns = new Map<string, { value?: TurnSubjects; wait: Promise<unknown> }>();

/** Each settled assistant turn's prose, across every row the turn wrote. */
function settledTurns(messages: readonly ChatMessage[]) {
  const text = new Map<string, string[]>();
  const running = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !message.turnId) continue;
    if (message.running) running.add(message.turnId);
    const parts = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));
    text.set(message.turnId, [...(text.get(message.turnId) ?? []), ...parts]);
  }
  return [...text].flatMap(([turnId, parts]) =>
    running.has(turnId) ? [] : [{ turnId, text: parts.join("\n") }],
  );
}

/** Reads each settled turn once; returns the frozen subjects of a turn, if it has any yet. */
export function useTurnSubjects(
  thread: string | undefined,
  messages: readonly ChatMessage[],
  fetchNames: Read = read,
) {
  const [, settle] = useState(0);
  useEffect(() => {
    if (!thread) return;
    let live = true;
    for (const { turnId, text } of settledTurns(messages)) {
      const key = `${thread}\u0000${turnId}`;
      let entry = turns.get(key);
      if (!entry) {
        const ids = [...new Set(proseIds(text))]
          .filter((id) => id > 0 && Number.isSafeInteger(id))
          .slice(0, TURN_ELEMENT_NAMES_LIMIT);
        if (!ids.length) continue;
        const made: { value?: TurnSubjects; wait: Promise<unknown> } = { wait: Promise.resolve() };
        made.wait = fetchNames({ kind: "turn-element-names", thread, turnId, ids }).then(
          (observation) => (made.value = linkedSubjects(observation, text)),
          () => (made.value = NONE),
        );
        turns.set(key, (entry = made));
      }
      if (!entry.value) void entry.wait.then(() => live && settle((n) => n + 1));
    }
    return () => {
      live = false;
    };
  }, [thread, messages, fetchNames]);
  return (turnId: string | undefined) =>
    thread && turnId ? turns.get(`${thread}\u0000${turnId}`)?.value : undefined;
}

/** Forget every frozen turn: tests only, so each case starts from an empty session. */
export const forgetTurnNames = () => turns.clear();

/** One linked id: a numbered Subject token scoped to the document it resolved in. */
export function TurnSubjectText({
  subject,
  connector,
}: {
  subject: TurnSubject;
  connector?: number;
}) {
  const part = { ...subject, connector };
  return (
    <SubjectTextContext value={{ doc: subject.doc, nameOf: () => subject.name }}>
      <SubjectText document={{ parts: [part], references: [subject] }} />
    </SubjectTextContext>
  );
}

/** Split prose at the linked ids, by the same rule SubjectText resolves them with. */
export function subjectParts(text: string, subjects: TurnSubjects) {
  return subjectDocument([text], (id) => subjects.get(id)?.name ?? null, [], [...subjects.values()])
    .parts;
}
