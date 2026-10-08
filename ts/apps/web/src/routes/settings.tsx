import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { HarnessId } from "@pe/agent-contracts";

import { RouteShell, emptyManifest } from "#/route";
import { Input } from "#/components/lang/input";
import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import { AccessSwitch } from "#/chat/first-open";
import { errorMessage } from "#/workbench/provider/use-workbench";
import { readinessSub, useProviders, type ProvidersState } from "#/workbench/provider/providers";

const manifest = {
  ...emptyManifest("settings", "Settings"),
  docs: "Providers: each harness with its own login, plus any endpoint (URL and key) you add. A thread binds one at its first send.",
};

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

const cell = "px-2 py-1 text-left";

function SettingsRoute() {
  const providers = useProviders("");
  return (
    <RouteShell manifest={manifest}>
      <div className="flex flex-col gap-4 p-6">
        <table className="t-small" aria-label="providers">
          <thead className="text-ink-2">
            <tr className="hairline-b">
              {["name", "harness", "auth", "readiness", "last probe", ""].map((head) => (
                <th key={head} className={cell}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(providers.list ?? []).map((provider) => (
              <tr key={provider.id} className="hairline-b">
                <td className={cell}>{provider.name}</td>
                <td className={`${cell} face-mono`}>{provider.harness}</td>
                <td className={`${cell} face-mono`}>
                  {provider.auth.kind === "subscription"
                    ? "subscription"
                    : `${new URL(provider.auth.baseUrl).host} · …${provider.auth.keyLast4}`}
                </td>
                <td
                  className={`${cell} face-mono`}
                  data-tone={provider.readiness.state === "ready" ? undefined : "caution"}
                >
                  {readinessSub(provider)}
                </td>
                <td className={`${cell} face-mono`}>{provider.probedAt ?? "never"}</td>
                <td className={cell}>
                  <span className="flex gap-1">
                    <Press
                      tone="quiet"
                      size="caption"
                      onClick={() => void providers.probe(provider.id)}
                    >
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
                </td>
              </tr>
            ))}
            <AddRow providers={providers} />
          </tbody>
        </table>
        {providers.error ? (
          <p className="t-small" data-tone="caution">
            {providers.error}
          </p>
        ) : null}
        <AccessSwitch providers={providers} />
      </div>
    </RouteShell>
  );
}

/** An endpoint provider: the host probes it before it saves, and a refusal says its step here. */
function AddRow({ providers }: { providers: ProvidersState }) {
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
    <tr>
      <td className={cell} colSpan={6}>
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
          <span className="w-40">
            <Input
              placeholder="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </span>
          <span className="w-72">
            <Input
              face="mono"
              placeholder="https://host/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </span>
          <span className="w-56">
            <Input
              type="password"
              face="mono"
              placeholder="API key"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </span>
          <span className="w-56">
            <Input
              face="mono"
              aria-label="Model to validate"
              placeholder="Model (automatic if empty)"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
          </span>
          <Press
            tone="quiet"
            size="caption"
            frame="line"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "probing…" : "Save"}
          </Press>
        </span>
        {refusal ? (
          <p className="face-mono whitespace-pre-wrap pt-1" data-tone="caution">
            {refusal}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
