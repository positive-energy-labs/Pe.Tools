/**
 * Providers and the access switch, as one hook both Chat and Settings read (`/pe/providers*`,
 * `/pe/access`). The host owns readiness; this only lists it, asks for a probe, and opens a login.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Access, AddProviderRequest, Provider } from "@pe/agent-contracts";
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

/** Readiness as one dot and the host's words: the head chip, the first-open card and Settings. */
export const readinessSub = (provider: Provider) =>
  provider.readiness.state === "ready" ? "● ready" : `○ ${provider.readiness.message}`;

export function useProviders(origin: string, enabled = true) {
  const client = useMemo(() => harnessClient(origin), [origin]);
  // Undefined until the host answered: nothing reads "none ready" from a list not yet fetched.
  const [list, setList] = useState<Provider[]>();
  const [access, setAccessState] = useState<Access>();
  const [error, setError] = useState<string>();
  const run = useCallback(async (work: () => Promise<unknown>) => {
    try {
      setError(undefined);
      await work();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);
  const replace = (next: Provider) =>
    setList((previous) => previous?.map((item) => (item.id === next.id ? next : item)));
  const probe = (id: string) => run(async () => replace(await client.probe(id)));
  useEffect(() => {
    if (!enabled) return;
    void run(async () => {
      const [providers, current] = await Promise.all([client.providers(), client.access()]);
      setList(providers);
      setAccessState(current);
    });
  }, [client, enabled, run]);
  return {
    list,
    access,
    error,
    probe,
    /** The harness's own login (or installer) in a console on this machine; re-probed on return. */
    openLogin: (id: string) =>
      run(async () => {
        await client.openLogin(id);
        window.addEventListener("focus", () => void probe(id), { once: true });
      }),
    setAccess: (guarded: boolean) =>
      run(async () => setAccessState(await client.setAccess({ guarded }))),
    /** Throws the host's `{step, message}` refusal as its words, for the form to say inline. */
    add: async (input: AddProviderRequest) => {
      const added = await client.addProvider(input);
      setList((previous) => [...(previous ?? []), added]);
    },
    remove: (id: string) =>
      run(async () => {
        await client.removeProvider(id);
        setList((previous) => previous?.filter((item) => item.id !== id));
      }),
  };
}

export type ProvidersState = ReturnType<typeof useProviders>;
