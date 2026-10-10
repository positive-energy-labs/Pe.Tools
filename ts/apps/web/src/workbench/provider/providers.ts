/**
 * Providers and agent approvals come from the shared Machine reading. Mutations invalidate it.
 */
import { useCallback, useMemo, useState } from "react";
import type { AddProviderRequest, Machine, Provider } from "@pe/agent-contracts";
import { dirty, useReading } from "#/readings";
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
export const isFresh = (provider: Provider) =>
  provider.probedAt !== null && Date.now() - Date.parse(provider.probedAt) < 60_000;

/** Readiness as one dot and the host's words: the head chip, the first-open card and Settings. */
export const readinessSub = (provider: Provider) =>
  provider.readiness.state === "ready"
    ? isFresh(provider)
      ? "● ready"
      : "○ last ready · probe expired"
    : `○ ${provider.readiness.message}`;

export function useProviders(origin: string, enabled = true, snapshot?: Machine) {
  const client = useMemo(() => harnessClient(origin), [origin]);
  const reading = useReading<Machine>(enabled && !snapshot ? { kind: "machine" } : null);
  const machine = snapshot ?? machineOf(reading);
  const list = machine?.providers ? [...machine.providers] : undefined;
  const access = machine?.access ?? undefined;
  const [error, setError] = useState<string>();
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
    error: error ?? machine?.legs.providers?.error ?? access?.readError,
    probe,
    /** The harness's own login (or installer) in a console on this machine; re-probed on return. */
    openLogin: (id: string) =>
      run(async () => {
        await client.openLogin(id);
        window.addEventListener("focus", () => void probe(id), { once: true });
      }),
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
