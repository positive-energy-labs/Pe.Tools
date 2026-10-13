import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import {
  HOST_CONTEXT_HEADER,
  HOST_CONTEXT_VARIABLE,
  HOST_RUNTIME_SERVICE_HEADER,
} from "@pe/host-contracts/contracts";
import { invocationContext, type RequestPrincipal } from "@pe/mcps/context";
import type {
  Basis,
  Caller,
  DocumentRef,
  ExecutionTarget,
  HeadGrant,
  PageChoice,
  Refusal,
  RefusalCode,
  ThreadHead,
} from "@pe/agent-contracts";

/**
 * The control spine (ADR 0017): who is calling, whether a crossing into Revit is admitted, and
 * whether the reason it was admitted still holds when a step begins. Contexts live in memory only;
 * a host restart kills every harness child, so a token from before it is `context.unknown`.
 */

/** A grant lives 60 minutes past the human's last message in its thread (ADR 0016). */
export const GRANT_MS = 60 * 60_000;

export class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(`${refusal.code}: ${refusal.reason}`);
  }
}
const refuse = (
  code: RefusalCode,
  door: string,
  reason: string,
  extra: Omit<Refusal, "code" | "door" | "reason"> = {},
) => new Refused({ code, door, reason, ...extra });

/* ── Contexts ─────────────────────────────────────────────────────────────────────────── */

type MintSpec =
  | { kind: "pea"; thread: string }
  | { kind: "external-mcp"; label: string }
  | { kind: "human"; via: "cli" };
const contexts = new Map<string, Caller>();

/** A secret bearer token for one caller. The receipt names `context` (an id), never the token. */
export function mintContext(spec: MintSpec): string {
  const token = randomBytes(24).toString("base64url");
  contexts.set(token, spec.kind === "human" ? spec : { ...spec, context: randomUUID() });
  return token;
}
export const retireContext = (token: string) => void contexts.delete(token);

/**
 * BUILD-RULES ruling 1: the owner's own terminal is a human. The host writes one `human/cli`
 * token beside its service receipt; the `pea` CLI reads it when it carries no context of its own.
 * Anything running as this Windows user can read it, Pea's shell included: this is a consent
 * marker for a cooperating agent, not a boundary against one.
 */
export function writeTerminalContext(serviceName: string) {
  // The host never calls itself under a context it inherited from the shell that started it.
  delete process.env[HOST_CONTEXT_VARIABLE];
  const token = mintContext({ kind: "human", via: "cli" });
  const path = hostContextTokenPath(serviceName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token, { mode: 0o600 });
  return {
    retire() {
      retireContext(token);
      rmSync(path, { force: true });
    },
  };
}

/** The D12 page key of a `/pages/<slug>/…` path; `<pod>--<page>` is a Pod's page. */
export const pageKeyOf = (slug: string) => {
  const [pod, page] = slug.split("--");
  return page ? `page:@${pod}/pages/${page}` : `page:@pages/${slug}`;
};
/** The write door of a page key: the inverse of `pageKeyOf`. */
export const pageActDoor = (page: string) => {
  const [, pkg = "", path = ""] = /^page:@([^/]+)\/(.+)$/.exec(page) ?? [];
  return pkg === "pages"
    ? `/pages/${path}/act`
    : `/pages/${pkg}--${path.replace(/^pages\//, "")}/act`;
};

/**
 * Mint the caller from the transport. A token wins and must be one this host minted; a browser
 * may never present one. A browser request carrying the runtime marker is a human when its
 * Referer is present and outside `/pages/`, a Page inside it; everything else is anonymous.
 */
export function callerOf(
  principal: RequestPrincipal,
  headers: Readonly<Record<string, string | undefined>>,
): { caller: Caller } | { refusal: { code: RefusalCode; detail: string } } {
  const token = headers[HOST_CONTEXT_HEADER];
  const browser = headers.origin !== undefined || headers["sec-fetch-site"] !== undefined;
  if (token !== undefined) {
    if (browser)
      return {
        refusal: {
          code: "context.unknown",
          detail: "A browser request cannot present a caller context.",
        },
      };
    const caller = contexts.get(token);
    return caller
      ? { caller }
      : {
          refusal: {
            code: "context.unknown",
            detail: "This host never minted that caller context, or it ended with a restart.",
          },
        };
  }
  const anonymous = { caller: { kind: "anonymous" } } as const;
  if (!browser || headers[HOST_RUNTIME_SERVICE_HEADER] === undefined || !headers.referer)
    return anonymous;
  const path = URL.parse(headers.referer)?.pathname;
  if (!path) return anonymous;
  if (path === "/pages" || path.startsWith("/pages/")) {
    const slug = /^\/pages\/([^/]+)\//.exec(path)?.[1];
    return slug
      ? { caller: { kind: "page", page: pageKeyOf(decodeURIComponent(slug)) } }
      : anonymous;
  }
  return {
    caller:
      principal.kind === "local"
        ? { kind: "human", via: "local" }
        : { kind: "human", via: "tailnet", login: principal.login },
  };
}

/** Route Work keeps its two-valued author: a human, or anything acting for one. */
export const routeActorOf = (caller: Caller): "human" | "agent" =>
  caller.kind === "human" ? "human" : "agent";

/** The caller the identity middleware minted for this request; anonymous outside one. */
export const currentCaller = (): Caller => invocationContext()?.caller ?? { kind: "anonymous" };

/** A human-only door: anonymous is `context.missing`, any other caller `human.only`. */
export function requireHuman(caller: Caller, door: string, what: string) {
  if (caller.kind === "human") return caller;
  throw caller.kind === "anonymous"
    ? refuse(
        "context.missing",
        door,
        `Refused at ${door}: no caller context; ${what} is a human act.`,
      )
    : refuse(
        "human.only",
        door,
        `Refused at ${door}: ${what} is human-only; ${caller.kind} calls are refused.`,
      );
}

/* ── Sources: the head store and whose a session is ───────────────────────────────────── */

type Sources = {
  heads: ((thread: string) => ThreadHead) | null;
  subscribeHeads?: (notify: () => void) => () => void;
  /** Fail closed: a session nobody has proven Pea's is yours. */
  whose: (session: string) => "you" | "pea";
};
const sources: Sources = { heads: null, whose: () => "you" };
/** Bound once at boot (and by tests): the harness head store and Machine's `whose`. */
export const bindControl = (bound: Partial<Sources>) => void Object.assign(sources, bound);
export const sessionWhose = (session: string) => sources.whose(session);
/** The head a thread carries now; null before the head store is bound. */
export const threadHead = (thread: string): ThreadHead | null => sources.heads?.(thread) ?? null;
export const subscribeHeads = (notify: () => void) =>
  sources.subscribeHeads?.(notify) ?? (() => {});

const sameRef = (a: DocumentRef, b: DocumentRef) =>
  a.session === b.session && a.openId === b.openId;
const hhmm = (iso: string) => iso.slice(11, 16);

/** A grant's own verdict at `now`; null while it holds. */
export function grantDead(
  grant: HeadGrant,
  now = Date.now(),
): "grant.revoked" | "grant.expired" | null {
  if (grant.revoked) return "grant.revoked";
  return Date.parse(grant.expiresAt) <= now ? "grant.expired" : null;
}
export const grantExpiry = (from: number) => new Date(from + GRANT_MS).toISOString();

const deadReason = (code: "grant.revoked" | "grant.expired", grant: HeadGrant | null) =>
  code === "grant.revoked"
    ? `rw was revoked${grant?.revoked ? ` at ${hhmm(grant.revoked.at)}` : ""}. Steps already running finish; nothing new starts. Re-point the head to grant again.`
    : `rw expired${grant ? ` at ${hhmm(grant.expiresAt)}` : ""} (60 min after your last message). Send a message in the thread to renew.`;

/* ── The crossing ─────────────────────────────────────────────────────────────────────── */

/**
 * Admit one crossing at `door`, or throw `Refused`. Null means the crossing touches no Revit
 * session (a host leaf) or is a lifecycle selection whose census belongs to the Instances action.
 */
export function admitCrossing(
  caller: Caller,
  destination: ExecutionTarget,
  door: string,
): Basis | null {
  if (caller.kind === "anonymous")
    throw refuse(
      "context.missing",
      door,
      `Refused at ${door}: no caller context. Anonymous loopback calls are read-only; run this from Pea, the web app, or a bound Page.`,
    );
  if (caller.kind === "page") {
    const admitted = pageDoors.get(caller);
    if (!admitted)
      throw refuse(
        "page.use-page-door",
        door,
        `Pages act through ${pageActDoor(caller.page)}, not ${door}.`,
      );
    return admitPage(admitted.slot, destination, admitted.door);
  }
  if (caller.kind === "human") return { kind: "human" };
  if (destination.kind === "host" || destination.kind === "sdk-session") return null;
  const session = destination.kind === "session" ? destination.session : destination.ref.session;
  if (sources.whose(session) === "pea") return { kind: "pea-session", session };
  if (caller.kind === "external-mcp")
    throw refuse(
      "grant.context-cannot-hold",
      door,
      `Refused at ${door}: this external MCP client can read any document and write Pea's own; rw grants for external clients are not in this release.`,
    );
  return admitThread(caller.thread, destination, door);
}

/** A thread's rw grant on a destination on your Revit: the exact lifetime, unrevoked, unexpired. */
function admitThread(
  thread: string,
  destination: Extract<ExecutionTarget, { kind: "session" | "document" }>,
  door: string,
): Basis {
  if (destination.kind === "session")
    throw refuse(
      "grant.required",
      door,
      `Refused at ${door}: this would act on your Revit session '${destination.session}', and a thread grant covers one document, never a session.`,
    );
  const head = sources.heads?.(thread) ?? null;
  const grant = head?.grant ?? null;
  const lifetime = destination.ref;
  if (!head || !grant)
    throw refuse(
      "grant.required",
      door,
      `Refused at ${door}: this would write your document ${lifetime.session}/${lifetime.openId}, and thread ${thread} holds no rw grant on it. Point this thread at it in the composer to grant rw, or open a copy.`,
      { remedy: "Point this thread at the document in the composer.", lifetime },
    );
  if (!sameRef(grant.lifetime, lifetime))
    throw refuse(
      "grant.other-lifetime",
      door,
      `Refused at ${door}: rw is granted on ${grant.lifetime.session}/${grant.lifetime.openId}, not on ${lifetime.session}/${lifetime.openId}. A per-call override writes only Pea's documents or the granted head.`,
      { lifetime: grant.lifetime },
    );
  const dead = grantDead(grant);
  if (dead)
    throw refuse(dead, door, `Refused at ${door}: ${deadReason(dead, grant)}`, { lifetime });
  return { kind: "grant", thread, headRevision: head.revision, lifetime };
}

/* ── Page doors (D9/D10) ──────────────────────────────────────────────────────────────── */

/**
 * A Page writes as itself under its slot: a thread slot under that thread's grant, a pinned slot
 * on Pea's documents only, no slot never. `door` is the page's own `/pages/<slug>/act`.
 */
export function admitPage(
  slot: PageChoice,
  destination: ExecutionTarget,
  door: string,
): Basis | null {
  if (slot.kind === "none")
    throw refuse(
      "page.unbound",
      door,
      `Refused at ${door}: this Page has no target. Bind it to a thread or pin a document from the chip.`,
    );
  if (destination.kind === "host" || destination.kind === "sdk-session") return null;
  const session = destination.kind === "session" ? destination.session : destination.ref.session;
  if (sources.whose(session) === "pea") return { kind: "pea-session", session };
  if (slot.kind === "pinned")
    throw refuse(
      "grant.required",
      door,
      `Refused at ${door}: a pinned Page writes only Pea's documents, and session '${session}' is your Revit. Bind this Page to a thread that holds rw on it.`,
      destination.kind === "document" ? { lifetime: destination.ref } : {},
    );
  return admitThread(slot.thread, destination, door);
}

/**
 * The page doors cross through the host's own `/actions` and `/call` under one context minted per
 * request. Only a caller minted here is admitted under a slot; a page's own browser request to
 * `/actions` (a Referer-minted `page`) is `page.use-page-door`.
 */
const pageDoors = new WeakMap<Caller, { slot: PageChoice; door: string }>();
export function mintPageDoor(page: string, slot: PageChoice, door: string) {
  const caller: Caller = { kind: "page", page };
  const token = randomBytes(24).toString("base64url");
  contexts.set(token, caller);
  pageDoors.set(caller, { slot, door });
  return { token, retire: () => retireContext(token) };
}

/**
 * D4: the step-begin check. A grant basis holds while its thread still grants that exact lifetime,
 * unrevoked and unexpired; every other basis holds for the attempt.
 */
export function live(basis: Basis | null, door = "step begin"): Refused | null {
  if (basis?.kind !== "grant") return null;
  const grant = sources.heads?.(basis.thread).grant ?? null;
  const code =
    !grant || !sameRef(grant.lifetime, basis.lifetime) ? "grant.revoked" : grantDead(grant);
  return code
    ? refuse(code, door, `Refused at ${door}: ${deadReason(code, grant)}`, {
        lifetime: basis.lifetime,
      })
    : null;
}

/* ── Revoke ───────────────────────────────────────────────────────────────────────────── */

type RevokeListener = (thread: string, grant: HeadGrant) => void;
const revokeListeners = new Set<RevokeListener>();
/** E2's queue sweep registers here; the head store fires it when a human revokes. */
export function onRevoke(listener: RevokeListener): () => void {
  revokeListeners.add(listener);
  return () => void revokeListeners.delete(listener);
}
export function emitRevoke(thread: string, grant: HeadGrant) {
  for (const listener of revokeListeners) listener(thread, grant);
}
