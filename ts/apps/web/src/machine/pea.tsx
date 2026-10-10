/**
 * The Pea group: harness readiness is machine state (agent ledger 2026-10-09), so the provider
 * list, sign-in, probe and endpoint config live here, in the drawer and the tray, and left
 * `/settings`. Each provider is a row with its readiness in the host's words and the one step
 * that readies it; an endpoint is probed by the host before it is saved.
 */
import { useState } from "react";
import type { HarnessId, Machine } from "@pe/agent-contracts";

import { Input } from "#/components/lang/input";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import {
  isFresh,
  readinessSub,
  useProviders,
  type ProvidersState,
} from "#/workbench/provider/providers";
import { errorMessage } from "#/workbench/provider/use-workbench";

export function PeaGroup({ fixture, machine }: { fixture: boolean; machine: Machine }) {
  const providers = useProviders("", !fixture, machine);
  if (fixture)
    return <span className="text-ink-2">Fixture: provider details are read from a live host.</span>;
  if (!providers.list)
    return providers.error ? (
      <OutcomeLine kind="error" label={providers.error} />
    ) : (
      <OutcomeLine kind="busy" label="reading providers" />
    );
  return (
    <div className="flex min-w-0 flex-col gap-1" aria-label="providers">
      {providers.list.map((provider) => (
        <div key={provider.id} className="hairline-b flex flex-col py-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{provider.name}</span>
            <span
              className="min-w-0 truncate face-mono"
              data-tone={
                provider.readiness.state === "ready" && isFresh(provider) ? undefined : "caution"
              }
              title={readinessSub(provider)}
            >
              {readinessSub(provider)}
            </span>
            <span className="ml-auto flex gap-1">
              <Press tone="quiet" size="caption" onClick={() => void providers.probe(provider.id)}>
                Probe
              </Press>
              {provider.auth.kind === "subscription" ? (
                <Press
                  tone="quiet"
                  size="caption"
                  title="open the harness's own login in a console on this machine"
                  onClick={() => void providers.openLogin(provider.id)}
                >
                  Sign in
                </Press>
              ) : (
                <Press
                  tone="quiet"
                  size="caption"
                  onClick={() => void providers.remove(provider.id)}
                >
                  Remove
                </Press>
              )}
            </span>
          </span>
          <span className="break-all face-mono text-ink-2">
            {provider.harness} ·{" "}
            {provider.auth.kind === "subscription"
              ? "subscription"
              : `${new URL(provider.auth.baseUrl).host} · …${provider.auth.keyLast4}`}{" "}
            · probed {provider.probedAt ?? "never"}
          </span>
        </div>
      ))}
      {providers.error ? <span data-tone="caution">{providers.error}</span> : null}
      <AddEndpoint providers={providers} />
    </div>
  );
}

/** An endpoint provider: the host probes it before it saves, and a refusal says its step here. */
function AddEndpoint({ providers }: { providers: ProvidersState }) {
  const [harness, setHarness] = useState<HarnessId>("codex");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const save = async () => {
    setBusy(true);
    setRefusal(undefined);
    try {
      await providers.add({
        harness,
        name,
        auth: {
          kind: "endpoint",
          baseUrl,
          apiKey,
          ...(modelId.trim() ? { modelId: modelId.trim() } : {}),
        },
      });
      setName("");
      setBaseUrl("");
      setApiKey("");
      setModelId("");
    } catch (caught) {
      setRefusal(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1 pt-1" aria-label="add endpoint">
      <span className="flex flex-wrap items-center gap-2">
        <span>Add endpoint</span>
        <Switcher
          ariaLabel="harness"
          value={harness}
          onChange={setHarness}
          options={[
            { value: "claude", label: "claude", title: "Claude Code over the Messages API" },
            { value: "codex", label: "codex", title: "Codex over the Responses API" },
          ]}
        />
      </span>
      <Input placeholder="name" value={name} onChange={(event) => setName(event.target.value)} />
      <Input
        face="mono"
        placeholder="https://host/v1"
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
      />
      <Input
        type="password"
        face="mono"
        placeholder="API key"
        autoComplete="off"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />
      <Input
        face="mono"
        aria-label="Model to validate"
        placeholder="Model (automatic if empty)"
        value={modelId}
        onChange={(event) => setModelId(event.target.value)}
      />
      <span>
        <Press tone="quiet" size="caption" frame="line" disabled={busy} onClick={() => void save()}>
          {busy ? "probing…" : "Save"}
        </Press>
      </span>
      {refusal ? (
        <p className="face-mono whitespace-pre-wrap" data-tone="caution">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
