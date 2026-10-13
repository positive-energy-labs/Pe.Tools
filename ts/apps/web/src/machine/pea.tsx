/**
 * The Pea group: harness readiness is machine state (agent ledger 2026-10-09), so the provider
 * list, sign-in, probe and endpoint config have one component shared by the drawer, tray,
 * composer and settings. Each provider is a row with its readiness in the host's words and the one step
 * that readies it; an endpoint is probed by the host before it is saved.
 */
import { useState, type ReactNode } from "react";
import { Plug } from "lucide-react";
import type { EndpointFailure, HarnessId, Machine } from "@pe/agent-contracts";

import { Input } from "#/components/lang/input";
import { ListSegmentInput } from "#/components/lang/list-popup";
import { OutcomeLine } from "#/components/lang/outcome";
import { Button } from "#/components/lang/button";
import {
  isFresh,
  readinessSub,
  useProviders,
  type ProvidersState,
} from "#/workbench/provider/providers";
import { EndpointError } from "#/workbench/endpoint-error";
import { errorMessage } from "#/workbench/provider/use-workbench";

export function PeaGroup({ fixture, machine }: { fixture: boolean; machine: Machine }) {
  const providers = useProviders("", !fixture, machine);
  if (fixture)
    return <span className="text-ink-2">Fixture: provider details are read from a live host.</span>;
  return <ProviderSetup providers={providers} />;
}

export function ProviderSetup({ providers }: { providers: ProvidersState }) {
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
              {provider.readiness.state === "refused" && provider.readiness.failure
                ? "refused"
                : readinessSub(provider)}
            </span>
            <span className="ml-auto flex gap-1">
              <Button label="Probe" onClick={() => void providers.probe(provider.id)}>
                Probe
              </Button>
              {provider.auth.kind === "subscription" ? (
                <Button
                  label={
                    provider.readiness.state === "refused" &&
                    provider.readiness.step === "installed"
                      ? "Install"
                      : "Sign in"
                  }
                  reason="open the harness installer or login in a console on this machine"
                  onClick={() => void providers.openLogin(provider.id)}
                >
                  {provider.readiness.state === "refused" && provider.readiness.step === "installed"
                    ? "Install"
                    : "Sign in"}
                </Button>
              ) : (
                <Button label="Remove" onClick={() => void providers.remove(provider.id)}>
                  Remove
                </Button>
              )}
            </span>
          </span>
          {provider.readiness.state === "refused" && provider.readiness.failure ? (
            <EndpointError
              message={provider.readiness.message}
              failure={provider.readiness.failure}
            />
          ) : null}
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

/** The labs' own marks, drawn in ink: the mark names the harness, colour stays a claim about state. */
const CodexMark = ({ className = "size-3.5" }: { className?: string }) => (
  <svg
    aria-hidden
    viewBox="-1 -1 26 26"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457z" />
    <path d="M6.55 8.73 8.55 12.06 6.55 15.39M12.73 15.39h4.85" />
  </svg>
);
const ClaudeMark = ({ className = "size-3.5" }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 256 257" className={className} fill="currentColor">
    <path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z" />
  </svg>
);
/** A custom endpoint: the plug, with the lab whose wire it speaks set small at its foot. */
const custom = (Lab: typeof CodexMark) => (
  <span aria-hidden className="flex items-end">
    <Plug className="size-3.5" />
    <Lab className="-ml-0.5 size-2 text-ink-2" />
  </span>
);

/** A lab pick fixes the URL to the lab's own API; a custom pick takes any endpoint speaking its wire. */
const ENDPOINTS: readonly {
  key: string;
  harness: HarnessId;
  label: string;
  name: string;
  lab?: string;
  mark: ReactNode;
}[] = [
  {
    key: "codex",
    harness: "codex",
    label: "Codex",
    name: "Codex · OpenAI API",
    lab: "https://api.openai.com/v1",
    mark: <CodexMark />,
  },
  {
    key: "claude",
    harness: "claude",
    label: "Claude",
    name: "Claude · Anthropic API",
    lab: "https://api.anthropic.com",
    mark: <ClaudeMark />,
  },
  {
    key: "custom-codex",
    harness: "codex",
    label: "Custom (OpenAI)",
    name: "Custom endpoint speaking the Responses API",
    mark: custom(CodexMark),
  },
  {
    key: "custom-claude",
    harness: "claude",
    label: "Custom (Anthropic)",
    name: "Custom endpoint speaking the Messages API",
    mark: custom(ClaudeMark),
  },
];

/** An endpoint provider: the host probes it before it saves, and a refusal says its step here. */
function AddEndpoint({ providers }: { providers: ProvidersState }) {
  const [endpoint, setEndpoint] = useState(ENDPOINTS[0]!);
  const { harness } = endpoint;
  const [name, setName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const baseUrl = endpoint.lab ?? customUrl;
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ message: string; failure?: EndpointFailure }>();
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
      setCustomUrl("");
      setApiKey("");
      setModelId("");
    } catch (caught) {
      setRefusal({
        message: errorMessage(caught),
        failure: (caught as { failure?: EndpointFailure } | null)?.failure,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1 pt-2" aria-label="add endpoint">
      <span className="text-ink-2">Add endpoint</span>
      <ListSegmentInput
        popup={{
          "aria-label": "endpoint",
          triggerLabel: endpoint.name,
          title: endpoint.name,
          trigger: endpoint.mark,
          items: ENDPOINTS,
          keyOf: (e) => e.key,
          labelOf: (e) => e.name,
          selected: [endpoint.key],
          empty: "no endpoints",
          onPick: setEndpoint,
          row: (e) => ({
            lead: <span className="flex w-5 justify-center">{e.mark}</span>,
            label: e.label,
            title: e.name,
          }),
        }}
        face="mono"
        aria-label="base URL"
        disabled={endpoint.lab !== undefined}
        placeholder={endpoint.lab ?? "https://host/v1"}
        value={endpoint.lab ? "" : customUrl}
        onChange={(event) => setCustomUrl(event.target.value)}
      />
      <span className="grid grid-cols-2 gap-1">
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
          placeholder="model (automatic)"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
        />
      </span>
      <span className="flex items-center gap-1">
        <Input placeholder="name" value={name} onChange={(event) => setName(event.target.value)} />
        <Button label="Save" kind="framed" busy={busy} onClick={() => void save()}>
          Save
        </Button>
      </span>
      {refusal ? <EndpointError {...refusal} /> : null}
    </div>
  );
}
