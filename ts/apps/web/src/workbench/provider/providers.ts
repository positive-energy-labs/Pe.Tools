/**
 * Providers and agent approvals come from the shared Machine reading. Mutations invalidate it.
 */
import { useCallback, useMemo, useState } from "react";
import type { AddProviderRequest, Machine, Provider, Reading } from "@pe/agent-contracts";
import { dirty, useReadingSlice } from "#/readings";
import { machineOf } from "#/machine/model";
import { harnessClient } from "./harness-client";
import { errorMessage } from "./use-workbench";

/** A composer pick before its thread exists. `providerId` null = Pea default (first ready). */
export interface HeadDraft {
  providerId: string | null;
  modelId: string | null;
  traits: Record<string, string | boolean>;
}
export const EMPTY_HEAD: HeadDraft = { providerId: null, modelId: null, traits: {} };

export const isReady = (provider: Provider) => provider.readiness.state === "ready";
/** Readiness as one dot and the host's words: the head chip, the first-open card and Settings.
 * Optimistic (kaitpw, 2026-10-12): the last probe stands until a probe or a send says otherwise;
 * a 60 s expiry read "probe expired" on providers that worked. */
export const readinessSub = (provider: Provider) =>
  provider.readiness.state === "ready" ? "● ready" : `○ ${provider.readiness.message}`;

/** The one press that repairs a subscription provider: Install when the CLI is missing, else Sign in. */
export const repairWord = (provider: Provider): "Install" | "Sign in" | null =>
  provider.auth.kind !== "subscription"
    ? null
    : provider.readiness.state === "refused" && provider.readiness.step === "installed"
      ? "Install"
      : "Sign in";

/** One Sign in or Install press, from the click until a probe has answered. */
export type Login =
  | { state: "opening" }
  | { state: "open"; probedAt: string | null }
  | { state: "failed"; message: string };

/**
 * What a press is doing, in one line under its provider row. Null once the host has probed again
 * (the row's own readiness speaks then) and before any press.
 */
export function loginLine(
  provider: Provider,
  login: Login | undefined,
): { kind: "busy" | "advisory" | "error"; label: string } | null {
  if (!login || isReady(provider)) return null;
  const what =
    provider.readiness.state === "refused" && provider.readiness.step === "installed"
      ? "installer"
      : "sign-in";
  switch (login.state) {
    case "opening":
      return { kind: "busy", label: `Opening the ${provider.name} ${what} console` };
    case "failed":
      return { kind: "error", label: login.message };
    case "open":
      return login.probedAt === provider.probedAt
        ? {
            kind: "advisory",
            label: `Finish ${what} in the console that opened; this updates when it closes`,
          }
        : null;
  }
}

export function useProviders(origin: string, enabled = true, snapshot?: Machine) {
  const client = useMemo(() => harnessClient(origin), [origin]);
  const observed = useReadingSlice(
    enabled && !snapshot ? { kind: "machine" } : null,
    (reading: Reading<Machine>) => {
      const machine = snapshot ?? machineOf(reading);
      return {
        list: machine?.providers,
        access: machine?.access ?? undefined,
        error: machine?.legs.providers?.error ?? machine?.access?.readError,
      };
    },
  );
  const list = useMemo(() => (observed.list ? [...observed.list] : undefined), [observed.list]);
  const access = observed.access;
  const [error, setError] = useState<string>();
  const [login, setLogin] = useState<Record<string, Login>>({});
  const run = useCallback(async (work: () => Promise<unknown>) => {
    try {
      setError(undefined);
      await work();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      dirty({ kind: "machine" });
    }
  }, []);
  const probe = (id: string) => run(() => client.probe(id));
  return {
    list,
    access,
    error: error ?? observed.error,
    probe,
    login,
    /** The harness's own login (or installer) in a console on this machine; re-probed on return. */
    openLogin: async (id: string) => {
      const press = (next: Login) => setLogin((current) => ({ ...current, [id]: next }));
      press({ state: "opening" });
      try {
        await client.openLogin(id);
        press({ state: "open", probedAt: list?.find((item) => item.id === id)?.probedAt ?? null });
        window.addEventListener("focus", () => void probe(id), { once: true });
      } catch (caught) {
        press({ state: "failed", message: errorMessage(caught) });
      } finally {
        dirty({ kind: "machine" });
      }
    },
    setAccess: (guarded: boolean) => run(() => client.setAccess({ guarded })),
    /** Throws the host's `{step, message}` refusal as its words, for the form to say inline. */
    add: async (input: AddProviderRequest) => {
      try {
        await client.addProvider(input);
      } finally {
        dirty({ kind: "machine" });
      }
    },
    remove: (id: string) => run(() => client.removeProvider(id)),
  };
}

export type ProvidersState = ReturnType<typeof useProviders>;
