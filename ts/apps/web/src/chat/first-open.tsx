/**
 * First open (agent LEDGER 2026-10-08): when no provider is ready the composer carries two doors.
 * "Chat here" readies a provider with the harness's own login; "Use your own app" connects
 * Claude desktop, Claude Code or Codex to Pea's tools over MCP.
 */
import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { LoginLine, ProviderSetup } from "#/machine/pea";
import type { Provider } from "@pe/agent-contracts";
import { Switch } from "#/components/lang/switch";
import { Switcher } from "#/components/lang/switcher";
import { repairWord, type ProvidersState } from "#/workbench/provider/providers";

/**
 * The one access switch (ADR 0021): it chooses the harness mode for new sessions and governs
 * Pea's writes to the open Revit documents. HTTP and MCP access are separate.
 */
export function AccessSwitch({ providers }: { providers: ProvidersState }) {
  const guarded = providers.access?.guarded;
  return (
    <label className="flex items-center gap-2 t-small">
      <Switch
        checked={guarded ?? true}
        disabled={guarded === undefined || providers.access?.readError !== undefined}
        onCheckedChange={(next) => void providers.setAccess(next)}
      />
      <span>Agent approvals</span>
      {/* I6: the switch says one word; what that word means is the hover. */}
      <TooltipHint
        content={
          guarded === false
            ? "Shell and file tools run without asking (new sessions); Pea may write any open Revit document"
            : "Shell and file tools ask first (new sessions); Pea writes only its own documents and the ones you add to a thread"
        }
      >
        <span className="text-ink-2">
          {guarded === undefined ? "reading…" : guarded ? "Guarded" : "Full"}
        </span>
      </TooltipHint>
    </label>
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
          <ProviderSetup providers={providers} />
          <AccessSwitch providers={providers} />
        </>
      ) : (
        <OwnAppDoor host={origin} />
      )}
    </section>
  );
}

/**
 * The provider this head runs on is not ready while another is: the composer carries that one
 * provider's words and its one repair, so a logged-out harness is never a silent Send.
 */
export function ProviderRepair({
  provider,
  providers,
}: {
  provider: Provider;
  providers: ProvidersState;
}) {
  const word = repairWord(provider);
  return (
    <section aria-label={`repair ${provider.name}`} className="hairline-b flex flex-col px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{provider.name}</span>
        <span className="min-w-0 truncate" data-tone="caution">
          {provider.readiness.state === "ready" ? "" : provider.readiness.message}
        </span>
        <span className="ml-auto flex gap-1">
          <Button label="Probe" onClick={() => void providers.probe(provider.id)}>
            Probe
          </Button>
          {word ? (
            <Button
              label={word}
              kind="framed"
              reason="open the harness installer or login in a console on this machine"
              onClick={() => void providers.openLogin(provider.id)}
            >
              {word}
            </Button>
          ) : null}
        </span>
      </div>
      <LoginLine provider={provider} providers={providers} />
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
            <Button
              label={copied === snippet.app ? "copied" : "copy"}
              onClick={() => {
                void navigator.clipboard?.writeText(snippet.text);
                setCopied(snippet.app);
              }}
            >
              {copied === snippet.app ? "copied" : "copy"}
            </Button>
          </div>
          <pre className="face-mono overflow-auto rounded-sm px-2 py-1" data-surface="recess">
            {snippet.text}
          </pre>
        </div>
      ))}
    </div>
  );
}
