import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { RouteShell, emptyManifest } from "#/route";
import { ActionButton } from "#/components/lang/action-button";
import { FactChip } from "#/components/lang/chip";
import { Input } from "#/components/lang/input";
import { Label } from "#/components/lang/label";
import type { InferenceEndpoint } from "@pe/host-contracts/operation-types";
import { hostUrl } from "#/host/client";
import { useAction, useHostCall } from "#/readings";

const manifest = {
  ...emptyManifest("settings", "Settings"),
  docs: "Advanced. Routes Codex threads through this endpoint; Claude threads ignore it.",
};

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

/** Plain host routes, not ops: the save carries a key, which must not reach the action journal. */
async function endpointCall(init?: RequestInit): Promise<InferenceEndpoint> {
  const response = await fetch(hostUrl("/host/inference-endpoint"), init);
  const body = (await response.json()) as InferenceEndpoint & { message?: string };
  if (!response.ok) throw new Error(body.message ?? response.statusText);
  return body;
}

/** Client-side refusals before any request; the host repeats the URL rules and owns the probe. */
export function endpointFormIssues(baseUrl: string, apiKey: string) {
  const issues: { baseUrl?: string; apiKey?: string } = {};
  try {
    const { protocol } = new URL(baseUrl.trim());
    if (protocol !== "http:" && protocol !== "https:")
      issues.baseUrl = `scheme must be http or https, got ${protocol}`;
  } catch {
    issues.baseUrl = "not a URL";
  }
  if (!apiKey) issues.apiKey = "required";
  else if (/\s/.test(apiKey)) issues.apiKey = "must not contain whitespace";
  return issues;
}

function SettingsRoute() {
  const saved = useHostCall((signal) => endpointCall({ signal }), ["inference-endpoint"]);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [touched, setTouched] = useState(false);
  const save = useAction(
    (request: { baseUrl: string; apiKey: string }) =>
      endpointCall({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    () => saved.refresh(),
  );
  const issues = endpointFormIssues(baseUrl, apiKey);
  const invalid = issues.baseUrl !== undefined || issues.apiKey !== undefined;
  const shown = touched ? issues : {};

  return (
    <RouteShell manifest={manifest}>
      <div className="flex max-w-xl flex-col gap-4 p-6">
        <section className="flex flex-wrap items-center gap-2">
          <FactChip title="the saved base URL">
            {saved.data?.baseUrl ?? "no endpoint saved"}
          </FactChip>
          {saved.data?.apiKeyRedacted ? (
            <FactChip title="the saved key, last 4 characters">
              {saved.data.apiKeyRedacted}
            </FactChip>
          ) : null}
          {saved.data?.probe ? (
            <FactChip title="the probe that admitted this endpoint">
              {saved.data.probe.model} · {saved.data.probe.atUtc}
            </FactChip>
          ) : null}
          {saved.error ? <p data-tone="alarm">{saved.error.message}</p> : null}
        </section>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => event.preventDefault()}
          noValidate
        >
          <Label>
            Base URL
            <Input
              face="mono"
              value={baseUrl}
              placeholder="http://127.0.0.1:8317/v1"
              aria-invalid={shown.baseUrl !== undefined || undefined}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Label>
          {shown.baseUrl ? <p data-tone="alarm">Base URL: {shown.baseUrl}</p> : null}
          <Label>
            API key
            <Input
              type="password"
              face="mono"
              value={apiKey}
              autoComplete="off"
              aria-invalid={shown.apiKey !== undefined || undefined}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </Label>
          {shown.apiKey ? <p data-tone="alarm">API key: {shown.apiKey}</p> : null}
          <div>
            <ActionButton
              tone="commit"
              label="Prove and save"
              busy={save.isPending}
              reason="Advanced. Routes Codex threads through this endpoint; Claude threads ignore it."
              onClick={() => {
                setTouched(true);
                if (!invalid) save.mutate({ baseUrl, apiKey });
              }}
            />
          </div>
          {save.error ? (
            <p data-tone="alarm" className="face-mono whitespace-pre-wrap">
              {save.error.message.replace(/^Error: /, "")}
            </p>
          ) : null}
        </form>
      </div>
    </RouteShell>
  );
}
