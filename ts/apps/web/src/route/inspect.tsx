/**
 * INSPECTABLES (MAP rulings 9, 15): a thing a verb produced has an address, `{ kind, id }`, and
 * its kind's open policy says how it opens — the host's default app for a path on disk, or a
 * route that displays it. The route manifest declares its kinds; the log and any receipt resolve
 * an address through the same `Inspect`, so there is one way to open a produced thing.
 */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { actionAdmissionSchema } from "@pe/agent-contracts";

import { Press } from "#/components/lang/press";
import { submitAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

export interface Inspectable {
  label: (id: string) => string;
  open:
    | { kind: "shell"; path: (id: string) => string }
    | { kind: "route"; to: string; search: (id: string) => Record<string, string> }
    /** A host endpoint the browser opens as a document (raw JSON), outside the app router. */
    | { kind: "href"; href: (id: string) => string };
}

/** An inspectable's address, as a log entry or receipt carries it. */
export interface InspectableRef {
  kind: string;
  id: string;
}

/** A pod member, opened in `/pods`. Its id is `JSON.stringify([pod, path])`. */
const MEMBER: Inspectable = {
  label: (id) => String((JSON.parse(id) as [string, string])[1].split("/").at(-1)),
  open: {
    kind: "route",
    to: "/pods",
    search: (id) => {
      const [pod, path] = JSON.parse(id) as [string, string];
      return { pod, path };
    },
  },
};

/** An action receipt, opened in `/ops`, where its recovery controls live. Its id is the action id. */
const RECEIPT: Inspectable = {
  label: (id) => `receipt ${id.slice(0, 8)}`,
  open: { kind: "route", to: "/ops", search: (id) => ({ actionId: id }) },
};

/** The kinds every route opens, beside the ones its manifest declares. */
export const inspectableOf = (
  declared: Readonly<Record<string, Inspectable>> | undefined,
  kind: string,
): Inspectable | undefined =>
  declared?.[kind] ?? (kind === "member" ? MEMBER : kind === "receipt" ? RECEIPT : undefined);

/** A capture's receipt: one log row whose label opens the first member it filed. */
export function noteCaptured(
  ctx: { note: (label: string, says: string, refused?: boolean, link?: InspectableRef) => void },
  entity: string,
  members: readonly { pod: string; path: string }[],
) {
  const [first] = members;
  if (!first) return;
  const link = { kind: "member", id: JSON.stringify([first.pod, first.path]) };
  ctx.note(
    `captured ${members.length} ${entity}`,
    members.map((m) => m.path).join(", "),
    false,
    link,
  );
}

/** Opening a path on the host is a host-local mutation, so it needs a journaled human admission. */
async function openOnHost(path: string): Promise<void> {
  const action = await submitAction(
    actionAdmissionSchema.parse({
      id: crypto.randomUUID(),
      kind: "operation",
      key: "host.shell.open",
      actor: "human",
      destination: { kind: "host" },
      input: { path },
      bases: {},
    }),
    "",
    30_000,
  );
  if (action.state !== "succeeded")
    throw Error(
      "error" in action && action.error ? String(action.error) : `host.shell.open ${action.state}`,
    );
}

/** One inspectable, opened by its kind's policy; a refused shell open says why on hover. */
export function Inspect({
  spec,
  id,
  children,
}: {
  spec: Inspectable;
  id: string;
  children?: ReactNode;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const text = children ?? spec.label(id);
  if (spec.open.kind === "route")
    return (
      <Link to={spec.open.to as never} search={spec.open.search(id) as never}>
        {text}
      </Link>
    );
  if (spec.open.kind === "href")
    return (
      <a href={spec.open.href(id)} target="_blank" rel="noreferrer">
        {text}
      </a>
    );
  const path = spec.open.path(id);
  return (
    <Press
      tone="nav"
      size="value"
      data-tone={refusal ? "caution" : undefined}
      title={refusal ?? `Open ${path} in the host's default app. Nothing is copied.`}
      onClick={() =>
        void openOnHost(path).then(
          () => setRefusal(null),
          (error: unknown) => setRefusal(error instanceof Error ? error.message : String(error)),
        )
      }
    >
      {text}
    </Press>
  );
}
