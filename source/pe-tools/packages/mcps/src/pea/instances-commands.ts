import { z } from "zod";
import type { InstancesDocument, RouteStateCommandHandlers } from "@pe/agent-contracts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

const relaySchema = z.looseObject({
  result: z.looseObject({
    state: z.string().optional(),
    revitYears: z.array(z.string()).optional(),
    activeDocument: z.json().optional(),
  }),
  diagnostics: z
    .array(z.object({ detail: z.string().nullable().optional(), code: z.string().optional() }))
    .default([]),
});

export function createInstancesCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<InstancesDocument> {
  const base = resolveHostBaseUrl(options.hostBaseUrl);
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(
      `${base}${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value: unknown = await response.json();
    const parsed = relaySchema.safeParse(value);
    if (!parsed.success) {
      const failure = z.object({ error: z.string() }).safeParse(value);
      throw Error(
        failure.success ? failure.data.error : `${path}: invalid SDK envelope (${response.status})`,
      );
    }
    return parsed.data;
  };
  const refuse = (detail: string) => ({ result: { state: "refused" }, diagnostics: [{ detail }] });
  const handlers: RouteStateCommandHandlers<InstancesDocument> = {
    recover: async () => ({ acknowledged: true }),
    refresh: async (_input, ctx) => {
      const [sessions, doctor] = await Promise.all([
        request("/sessions?all=true"),
        request("/doctor"),
      ]);
      const years: string[] = doctor.result.revitYears ?? [];
      const recents = await Promise.all(
        years.map(async (year) => ({
          year,
          ...(await request(`/docs/recents?year=${encodeURIComponent(year)}`)).result,
        })),
      );
      const doc = ctx.getDoc();
      doc.observation = z
        .json()
        .parse({ at: new Date().toISOString(), sessions: sessions.result, years, recents });
      await ctx.setDoc(doc);
      return doc.observation;
    },
  };
  for (const action of ["open", "start", "restart", "stop", "close"] as const) {
    handlers[action] = async (input, ctx) => {
      const doc = ctx.getDoc();
      const staged = doc.staged;
      const args = input as { force?: boolean; document?: string; intent?: string };
      let path: string;
      let body: unknown;
      if (action === "open" || action === "start") {
        if (!staged || staged.kind !== action) return refuse(`Stage ${action} before running it.`);
        if (staged.kind === "open") {
          path = "/docs/open";
          body = {
            id: staged.session.slice(8),
            path: staged.document,
            ...(staged.document.startsWith("cld:") ? { conflictPolicy: "keep" } : {}),
          };
        } else {
          if (!/^[a-zA-Z0-9._-]{1,64}$/.test(staged.name))
            return refuse("Name the session using letters, digits, dots, hyphens or underscores.");
          path = "/sessions";
          body = {
            action,
            lane: "installed",
            id: staged.name,
            year: staged.year,
            ...(staged.document ? { doc: staged.document } : {}),
            ...(staged.document?.startsWith("cld:") ? { conflictPolicy: "keep" } : {}),
          };
        }
      } else {
        if (!doc.selectedSession) return refuse("Select a session first.");
        const id = doc.selectedSession.slice(8);
        path = action === "close" ? "/docs/close" : "/sessions";
        body =
          action === "close"
            ? { id, doc: args.document, intent: args.intent }
            : { action, id, ...(action === "stop" ? { force: args.force ?? false } : {}) };
      }
      const receipt = await request(path, body);
      if (
        (action === "open" && receipt.result.state === "ok") ||
        (action === "start" && ["ready", "existing"].includes(receipt.result.state ?? ""))
      ) {
        const session =
          staged?.kind === "start"
            ? `session:${staged.name}`
            : staged?.kind === "open"
              ? staged.session
              : doc.selectedSession;
        const current = await request(`/docs/current?id=${encodeURIComponent(session!.slice(8))}`);
        receipt.target = { session, document: current.result.activeDocument ?? null };
      }
      doc.outcome = { action, at: new Date().toISOString(), receipt: z.json().parse(receipt) };
      // A returned SDK failure remains visible and does not discard the staged request.
      const state = receipt.result.state;
      if (
        (action === "open" && state === "ok") ||
        (action === "start" && ["ready", "existing"].includes(state ?? ""))
      ) {
        doc.selectedSession =
          action === "start" && staged?.kind === "start"
            ? `session:${staged.name}`
            : doc.selectedSession;
        doc.staged = null;
      }
      await ctx.setDoc(doc);
      return receipt;
    };
  }
  return handlers;
}
