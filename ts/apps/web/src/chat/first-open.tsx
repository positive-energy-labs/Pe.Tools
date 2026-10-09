/**
 * First open (agent LEDGER 2026-10-08): when no provider is ready the composer carries two doors.
 * "Chat here" readies a provider with the harness's own login; "Use your own app" connects
 * Claude desktop, Claude Code or Codex to Pea's tools over MCP.
 */
import { useState } from "react";
import type { Provider } from "@pe/agent-contracts";
import { Press } from "#/components/lang/press";
import { openMachine } from "#/machine/door";
import { Switch } from "#/components/lang/switch";
import { Switcher } from "#/components/lang/switcher";
import { readinessSub, type ProvidersState } from "#/workbench/provider/providers";

/** The access switch, in this card and in Settings: on = the harness's guarded mode. */
export function AccessSwitch({ providers }: { providers: ProvidersState }) {
  const guarded = providers.access?.guarded;
  return (
    <label className="flex items-center gap-2 t-small">
      <Switch
        checked={guarded ?? true}
        disabled={guarded === undefined}
        onCheckedChange={(next) => void providers.setAccess(next)}
      />
      <span>Pea asks before each change</span>
      <span className="text-ink-2">
        {guarded === undefined ? "reading…" : guarded ? "guarded, for new users" : "full access"}
      </span>
    </label>
  );
}

/** The verb that readies a provider: the step its readiness names. */
function ReadyVerb({ provider, providers }: { provider: Provider; providers: ProvidersState }) {
  const { readiness } = provider;
  if (readiness.state === "ready") return null;
  if (provider.auth.kind === "endpoint")
    return (
      <Press tone="quiet" size="caption" frame="line" onClick={() => openMachine("pea")}>
        Open providers
      </Press>
    );
  if (readiness.state === "unknown")
    return (
      <Press
        tone="quiet"
        size="caption"
        frame="line"
        onClick={() => void providers.probe(provider.id)}
      >
        Probe
      </Press>
    );
  return (
    <Press
      tone="quiet"
      size="caption"
      frame="line"
      onClick={() => void providers.openLogin(provider.id)}
    >
      {readiness.step === "installed" ? "Install" : "Sign in"}
    </Press>
  );
}

export function FirstOpenCard({
  providers,
  origin,
}: {
  providers: ProvidersState;
  origin: string;
}) {
  const [door, setDoor] = useState<"here" | "app">("here");
  return (
    <section aria-label="set up Pea" className="hairline-b flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="font-semibold">No provider is ready</span>
        <Switcher
          ariaLabel="door"
          value={door}
          onChange={setDoor}
          options={[
            { value: "here", label: "Chat here", title: "ready a provider and chat in Pea" },
            {
              value: "app",
              label: "Use your own app",
              title: "connect Claude or Codex to Pea's tools",
            },
          ]}
        />
      </div>
      {door === "here" ? (
        <>
          {(providers.list ?? []).map((provider) => (
            <div key={provider.id} className="flex items-center gap-3 t-small">
              <span className="w-40 shrink-0">{provider.name}</span>
              <span
                className="face-mono min-w-0 flex-1 truncate"
                data-tone="caution"
                title={readinessSub(provider)}
              >
                {readinessSub(provider)}
              </span>
              <ReadyVerb provider={provider} providers={providers} />
            </div>
          ))}
          {providers.error ? (
            <p className="t-small" data-tone="caution">
              {providers.error}
            </p>
          ) : null}
          <AccessSwitch providers={providers} />
        </>
      ) : (
        <OwnAppDoor host={origin} />
      )}
    </section>
  );
}

function OwnAppDoor({ host }: { host: string }) {
  const [copied, setCopied] = useState<string>();
  const snippets = [
    {
      app: "Claude desktop",
      where: "claude_desktop_config.json",
      text: JSON.stringify(
        { mcpServers: { pea: { command: "pea", args: ["mcp", "--host", host] } } },
        null,
        2,
      ),
    },
    {
      app: "Claude Code",
      where: "terminal",
      text: `claude mcp add --transport stdio pea -- pea mcp --host ${host}`,
    },
    {
      app: "Codex",
      where: "~/.codex/config.toml",
      text: `[mcp_servers.pea]\ncommand = "pea"\nargs = ${JSON.stringify(["mcp", "--host", host])}`,
    },
  ];
  return (
    <div className="flex flex-col gap-2 t-small">
      <div>
        Pea's tools over local stdio. Your app starts <code className="face-mono">pea mcp</code> on
        this machine; keep this host running.
      </div>
      <p className="text-ink-2">
        Use a pea version with the mcp command on your app's PATH. Remote MCP access is not
        available. Calls can name a target; shared Families views and query changes require a Pea
        chat thread.
      </p>
      {snippets.map((snippet) => (
        <div key={snippet.app} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span>{snippet.app}</span>
            <span className="text-ink-2">{snippet.where}</span>
            <Press
              tone="quiet"
              size="caption"
              onClick={() => {
                void navigator.clipboard?.writeText(snippet.text);
                setCopied(snippet.app);
              }}
            >
              {copied === snippet.app ? "copied" : "copy"}
            </Press>
          </div>
          <pre className="face-mono overflow-auto rounded-sm px-2 py-1" data-surface="recess">
            {snippet.text}
          </pre>
        </div>
      ))}
    </div>
  );
}
