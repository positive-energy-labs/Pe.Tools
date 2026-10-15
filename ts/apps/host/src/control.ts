import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import {
  HOST_CONTEXT_HEADER,
  HOST_CONTEXT_VARIABLE,
  HOST_RUNTIME_SERVICE_HEADER,
} from "@pe/host-contracts/contracts";
import { invocationContext, type RequestPrincipal } from "@pe/runtime/context";
import { hostOwnership } from "./host-ownership.ts";
import { parseContributionKey } from "@pe/agent-contracts";
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
const GRANT_MS = 60 * 60_000;

export class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(`${refusal.code}: ${refusal.reason}`);
  }
}
/** A door's 403 names its refusal code here; request admission counts it (request-identity.ts). */
export const REFUSAL_HEADER = "x-pe-refusal";
export const refusalHeaders = (code: RefusalCode) => ({ [REFUSAL_HEADER]: code });
const refuse = (
  code: RefusalCode,
  door: string,
  reason: string,
  extra: Omit<Refusal, "code" | "door" | "reason"> = {},
) => new Refused({ code, door, reason, ...extra });

/* ── Contexts ─────────────────────────────────────────────────────────────────────────── */

type MintSpec =
  | { kind: "pea"; thread: string }
  | { kind: "external-mcp"; label: string; device?: string }
  | { kind: "human"; via: "cli" };
const contexts = new Map<string, Caller>();
const BROWSER_CONTEXT_COOKIE = `pe-browser-${hostOwnership.serviceName}`;
const browserContexts = new Map<
  string,
  { caller: Extract<Caller, { kind: "human" }>; transport: string }
>();
const transportKey = (principal: RequestPrincipal) => JSON.stringify(principal);

/** Mint on a verified SPA navigation; headers on a later API request cannot create a human. */
export function mintBrowserContext(principal: RequestPrincipal): string {
  const token = randomBytes(24).toString("base64url");
  browserContexts.set(token, {
    transport: transportKey(principal),
    caller:
      principal.kind === "local"
        ? { kind: "human", via: "local" }
        : {
            kind: "human",
            via: principal.kind === "tailnet" ? "tailnet" : principal.transport,
            login: principal.login,
          },
  });
  return `${BROWSER_CONTEXT_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${principal.kind === "local" ? "" : "; Secure"}`;
}

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
      // A competing host may have written the path since (acceptance R4d): remove only our own.
      if (existsSync(path) && readFileSync(path, "utf8") === token) rmSync(path);
    },
  };
}

/**
 * The D12 page key of a `/pages/<slug>/…` path: `<id>--<page>` is the page an admitted package
 * (by manifest id) contributes; null when the codec admits no key for it.
 */
export const pageKeyOf = (slug: string): string | null => {
  const [id, page, ...more] = slug.split("--");
  const key = page === undefined ? `page:@pages/${slug}` : `page:@${id}/pages/${page}`;
  return !more.length && parseContributionKey(key) ? key : null;
};
/** The write door of a page key: the inverse of `pageKeyOf`. */
export const pageActDoor = (page: string) => {
  const ref = parseContributionKey(page);
  if (ref?.kind !== "page") throw Error(`'${page}' is not a Page key`);
  return ref.packageId === "pages"
    ? `/pages/${ref.path}/act`
    : `/pages/${ref.packageId}--${ref.path.slice("pages/".length)}/act`;
};

/**
 * Mint the caller from the transport. A token wins and must be one this host minted; a browser
 * may never present one. A browser needs a host-minted, transport-bound HttpOnly cookie.
 * Page Referers still act as Pages; a missing Referer is anonymous.
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
    const page = slug ? pageKeyOf(decodeURIComponent(slug)) : null;
    return page ? { caller: { kind: "page", page } } : anonymous;
  }
  const cookie = headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${BROWSER_CONTEXT_COOKIE}=`))
    ?.slice(BROWSER_CONTEXT_COOKIE.length + 1);
  const minted = cookie ? browserContexts.get(cookie) : undefined;
  return minted?.transport === transportKey(principal) ? { caller: minted.caller } : anonymous;
}

export type RoutePermission =
  | import("@pe/host-contracts/pe-api").PeRoutePermission
  | "service"
  | "mcp";

/** Transport admission consumes the declared permission, independently of document rw admission. */
export function admitRequest(
  caller: Caller,
  permission: RoutePermission,
  door: string,
  remote?: { paired: boolean; allowAdministration: boolean },
): void {
  if (remote && !remote.paired)
    throw refuse(
      "device.unpaired",
      door,
      "Pair this device from Sharing settings on the host before using host control.",
    );
  if (remote && !remote.allowAdministration && (permission === "admin" || permission === "grant"))
    throw refuse(
      "identity.remote-administration",
      door,
      "Remote administration and remote rw consent are disabled on this host.",
    );
  if (
    ![
      "read",
      "caller",
      "operation",
      "human",
      "admin",
      "grant",
      "human-or-pea",
      "human-or-page",
      "service",
      "mcp",
      "pair",
    ].includes(permission)
  )
    throw refuse(
      "permission.undeclared",
      door,
      `Refused at ${door}: this route declares no permission.`,
    );
  if (permission === "read" || permission === "mcp" || permission === "pair") return;
  // The add-in's context-free callbacks reach /call; its door admits them by key (`admitAnonymousCall`).
  if (permission === "operation" && caller.kind === "anonymous") return;
  if (caller.kind === "anonymous")
    throw refuse("context.missing", door, `Refused at ${door}: anonymous callers are read-only.`);
  if (permission === "human" || permission === "admin") {
    requireHuman(caller, door, "this route");
    return;
  }
  if (permission === "service" && caller.kind === "service") return;
  if (caller.kind === "service" || permission === "service")
    throw refuse(
      "human.only",
      door,
      `Refused at ${door}: the service caller is limited to shutdown and window.`,
    );
  if (caller.kind === "external-mcp" && permission !== "operation")
    throw refuse(
      "grant.context-cannot-hold",
      door,
      `Refused at ${door}: external MCP is read-only until human pairing exists.`,
    );
  if (
    (permission === "grant" || permission === "human-or-pea") &&
    caller.kind !== "human" &&
    caller.kind !== "pea"
  )
    throw refuse(
      "human.only",
      door,
      `Refused at ${door}: only a human or Pea may select a binding.`,
    );
  if (permission === "human-or-page" && caller.kind !== "page" && caller.kind !== "human")
    throw refuse(
      "page.binding-not-yours",
      door,
      `Refused at ${door}: only a Page or human may use this binding.`,
    );
}

/** What Pe.App's `TsHostCallClient` asks with no context: host-local Pod reads for native scripts. */
const ANONYMOUS_CALL_KEYS = new Set(["pod.list", "pod.capture"]);

/** At /call an anonymous caller runs only the add-in's two Pod reads; every other key refuses. */
export function admitAnonymousCall(caller: Caller, key: string): void {
  if (caller.kind === "anonymous" && !ANONYMOUS_CALL_KEYS.has(key))
    throw refuse(
      "context.missing",
      "/call",
      `Refused at /call: an anonymous caller may only read Pods, not '${key}'.`,
    );
}

/** Route Work keeps its two-valued author: a human, or anything acting for one. */
export const routeActorOf = (caller: Caller): "human" | "agent" =>
  caller.kind === "human" ? "human" : "agent";

/**
 * The caller the identity middleware minted for this request; anonymous outside one. A door reads
 * it once, before its first suspension, and passes it down: an Effect fiber resumed by a socket or
 * bridge callback runs outside the request's AsyncLocalStorage (`caller-carriage.test.ts`).
 */
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

/* ── Sources: the head store and what Pea's acquisitions hold ─────────────────────────── */

type Sources = {
  heads: ((thread: string) => ThreadHead) | null;
  subscribeHeads?: (notify: () => void) => () => void;
  /** The acquisition that holds this exact lifetime; null (fail closed) when none is proven. */
  acquired: (lifetime: DocumentRef) => string | null;
  /** The held acquisition that started the Revit behind this bridge session. */
  acquiredSession: (session: string) => string | null;
  deviceThread?: (device: string) => string | null;
};
const sources: Sources = { heads: null, acquired: () => null, acquiredSession: () => null };
/** Bound once at boot (and by tests): the harness head store and Machine's acquisitions. */
export const bindControl = (bound: Partial<Sources>) => void Object.assign(sources, bound);
export const documentAcquisition = (lifetime: DocumentRef) => sources.acquired(lifetime);
export const sessionAcquisition = (session: string) => sources.acquiredSession(session);

function acquisitionBasis(
  destination: Extract<ExecutionTarget, { kind: "session" | "document" }>,
): Basis | null {
  if (destination.kind === "document") {
    const id = sources.acquired(destination.ref);
    return id
      ? { kind: "acquisition", id, scope: { kind: "document", lifetime: destination.ref } }
      : null;
  }
  const id = sources.acquiredSession(destination.session);
  return id
    ? { kind: "acquisition", id, scope: { kind: "process", session: destination.session } }
    : null;
}
/** The head a thread carries now; null before the head store is bound. */
export const threadHead = (thread: string): ThreadHead | null => sources.heads?.(thread) ?? null;
export const callerThread = (caller: Caller): string | null =>
  caller.kind === "pea"
    ? caller.thread
    : caller.kind === "external-mcp" && caller.device
      ? (sources.deviceThread?.(caller.device) ?? null)
      : null;
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

/** K9: a ReadOnly target needs read consent; every other open lifetime still needs write authority. */
export function admitScript(
  caller: Caller,
  documents: readonly DocumentRef[],
  door: string,
  readTarget?: DocumentRef,
): void {
  if (caller.kind === "human") return;
  const ungranted = documents.filter((ref) => {
    if (readTarget && sameRef(ref, readTarget) && readConsent(caller, readTarget)) return false;
    try {
      admitCrossing(caller, { kind: "document", ref }, door);
      return false;
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return true;
    }
  });
  if (ungranted.length)
    throw refuse(
      "script.ungranted-documents",
      door,
      `Refused at ${door}: scripts can access every open document. Close the ungranted documents or run on a separate copy: ${ungranted.map((ref) => `${ref.session}/${ref.openId}`).join(", ")}.`,
    );
}

const deadReason = (code: "grant.revoked" | "grant.expired", grant: HeadGrant | null) =>
  code === "grant.revoked"
    ? `rw was revoked${grant?.revoked ? ` at ${hhmm(grant.revoked.at)}` : ""}. Steps already running finish; nothing new starts. Re-point the head to grant again.`
    : `rw expired${grant ? ` at ${hhmm(grant.expiresAt)}` : ""} (60 min after your last message). Send a message in the thread to renew.`;

/* ── The crossing ─────────────────────────────────────────────────────────────────────── */

/**
 * A script whose requested mode is ReadOnly (the contract default). Revit rolls back its changes to
 * the target document, so the target needs no grant; the guard does not roll back a commit on a
 * sibling document, so `admitScript`'s K9 census still holds for every other open document. It is
 * a read for a human, for Pea on an exact document, and for a Page pinned by a human to this exact
 * document. External MCP keeps it a write. NoTransaction and WriteTransaction are always writes.
 */
export const readsOnly = (key: string, input: unknown): boolean =>
  key === "scripting.execute" &&
  ((input as { permissionMode?: unknown } | null)?.permissionMode ?? "ReadOnly") === "ReadOnly";

/** Who may run a ReadOnly script on `target` without a grant; a person's pin consents only to its own lifetime. */
const readConsent = (caller: Caller, target?: DocumentRef): boolean => {
  const consent = caller.kind === "page" ? pageDoors.get(caller)?.readConsent : null;
  return (
    caller.kind === "human" ||
    (caller.kind === "pea" && !!target) ||
    !!(consent && target && sameRef(consent, target))
  );
};
export const consentedRead = (
  caller: Caller,
  key: string,
  input: unknown,
  target?: DocumentRef,
): boolean => readsOnly(key, input) && readConsent(caller, target);

/**
 * Admit one crossing at `door`, or throw `Refused`. Null means the crossing needs no basis: a
 * consented read, a host leaf, or a lifecycle selection whose census belongs to the Instances
 * action. `scriptReads` is `readsOnly`: a read for Pea on an exact document and for a human-pinned
 * Page's exact target; the script's K9 sibling census follows in `admitScript`.
 */
export function admitCrossing(
  caller: Caller,
  destination: ExecutionTarget,
  door: string,
  scriptReads = false,
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
    const reads =
      scriptReads &&
      destination.kind === "document" &&
      admitted.readConsent !== null &&
      sameRef(admitted.readConsent, destination.ref);
    return admitPage(admitted.slot, destination, admitted.door, reads);
  }
  if (caller.kind === "human") return { kind: "human" };
  if (caller.kind === "external-mcp" && caller.device) {
    const thread = callerThread(caller);
    if (!thread || destination.kind !== "document")
      throw refuse(
        "grant.context-cannot-hold",
        door,
        "This MCP device needs a host-approved thread with rw on this exact document.",
      );
    return { ...admitThread(thread, destination, door), device: caller.device };
  }
  if (caller.kind === "service" || caller.kind === "external-mcp")
    throw refuse(
      "grant.context-cannot-hold",
      door,
      `Refused at ${door}: ${caller.kind} has no product write authority.`,
    );
  if (
    destination.kind === "host" ||
    destination.kind === "sdk-session" ||
    (scriptReads && destination.kind === "document")
  )
    return null;
  const acquired = acquisitionBasis(destination);
  if (acquired) return acquired;
  return admitThread(caller.thread, destination, door);
}

/** A thread's rw grant on a destination on your Revit: the exact lifetime, unrevoked, unexpired. */
function admitThread(
  thread: string,
  destination: Extract<ExecutionTarget, { kind: "session" | "document" }>,
  door: string,
): Extract<Basis, { kind: "grant" }> {
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
  reads = false,
): Basis | null {
  if (slot.kind === "none")
    throw refuse(
      "page.unbound",
      door,
      `Refused at ${door}: this Page has no target. Bind it to a thread or pin a document from the chip.`,
    );
  if (reads || destination.kind === "host" || destination.kind === "sdk-session") return null;
  const acquired = acquisitionBasis(destination);
  if (acquired) return acquired;
  const session = destination.kind === "session" ? destination.session : destination.ref.session;
  if (slot.kind === "pinned")
    throw refuse(
      "grant.required",
      door,
      `Refused at ${door}: a pinned Page writes only documents Pea acquired, and this one in session '${session}' is not one. Bind this Page to a thread that holds rw on it.`,
      destination.kind === "document" ? { lifetime: destination.ref } : {},
    );
  return admitThread(slot.thread, destination, door);
}

/**
 * The page doors cross through the host's own `/actions` and `/call` under one context minted per
 * request. Only a caller minted here is admitted under a slot; a page's own browser request to
 * `/actions` (a Referer-minted `page`) is `page.use-page-door`.
 */
const pageDoors = new WeakMap<
  Caller,
  { slot: PageChoice; door: string; readConsent: DocumentRef | null }
>();
export function mintPageDoor(
  page: string,
  slot: PageChoice,
  door: string,
  humanBound: boolean,
  target: DocumentRef | null,
) {
  const caller: Caller = { kind: "page", page };
  const token = randomBytes(24).toString("base64url");
  contexts.set(token, caller);
  pageDoors.set(caller, {
    slot,
    door,
    readConsent: humanBound && slot.kind === "pinned" ? target : null,
  });
  return { token, retire: () => retireContext(token) };
}

/**
 * D4: the step-begin check. A grant basis holds while its thread still grants that exact lifetime,
 * unrevoked and unexpired; a document acquisition while that acquisition still holds that exact
 * lifetime; every other basis holds for the attempt.
 */
export function live(basis: Basis | null, door = "step begin"): Refused | null {
  if (basis?.kind === "grant" && basis.device) {
    try {
      if (sources.deviceThread?.(basis.device) !== basis.thread)
        return refuse(
          "grant.revoked",
          door,
          "This device no longer holds the admitted thread binding.",
        );
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return error;
    }
  }
  if (basis?.kind === "acquisition" && basis.scope.kind === "document")
    return sources.acquired(basis.scope.lifetime) === basis.id
      ? null
      : refuse(
          "acquisition.unproven",
          door,
          `Refused at ${door}: acquisition '${basis.id}' no longer holds ${basis.scope.lifetime.session}/${basis.scope.lifetime.openId} (closed, released, or no longer certified independent).`,
          { lifetime: basis.scope.lifetime },
        );
  if (basis?.kind !== "grant") return null;
  const head = sources.heads?.(basis.thread);
  const grant = head?.grant ?? null;
  const code =
    !grant || head?.revision !== basis.headRevision || !sameRef(grant.lifetime, basis.lifetime)
      ? "grant.revoked"
      : grantDead(grant);
  return code
    ? refuse(code, door, `Refused at ${door}: ${deadReason(code, grant)}`, {
        lifetime: basis.lifetime,
      })
    : null;
}

/* ── Revoke ───────────────────────────────────────────────────────────────────────────── */

type RevokeListener = (thread: string, grant: HeadGrant) => void;
const revokeListeners = new Set<RevokeListener>();
/** E2's queue sweep registers here; the head store fires it when a grant ends: revoked, or retired by a head move. */
export function onRevoke(listener: RevokeListener): () => void {
  revokeListeners.add(listener);
  return () => void revokeListeners.delete(listener);
}
export function emitRevoke(thread: string, grant: HeadGrant) {
  for (const listener of revokeListeners) listener(thread, grant);
}
