/**
 * First run, drawn from seeded providers: a brand-new install through each step to a working
 * turn, and the selected-provider repair. Nothing here reaches a host.
 */
import { useState } from "react";
import type { Provider } from "@pe/agent-contracts";

import { FirstOpenCard, ProviderRepair } from "#/chat/first-open";
import { Switcher } from "#/components/lang/switcher";
import { MachineBody } from "#/machine/body";
import { UpdateGroup } from "#/machine/update";
import { MACHINE_SEEDS } from "#/open/seeds";
import type { Login, ProvidersState } from "#/workbench/provider/providers";

import { Demo } from "./exhibit";

const provider = (
  id: "claude" | "codex",
  name: string,
  readiness: Provider["readiness"],
): Provider => ({
  id,
  harness: id,
  name,
  auth: { kind: "subscription" },
  readiness,
  models: [],
  traits: [],
  probedAt: "2026-10-13T09:00:00.000Z",
});

const MISSING = (name: string, cli: string): Provider["readiness"] => ({
  state: "refused",
  step: "installed",
  message: `${name} is not installed: no ${cli}.exe in its installer's folder or on your PATH.`,
});
const SIGNED_OUT = (name: string): Provider["readiness"] => ({
  state: "refused",
  step: "signed-in",
  message: `${name} is not signed in (Not logged in).`,
});

const claudeMissing = provider("claude", "Claude Code", MISSING("Claude Code", "claude"));
const codexMissing = provider("codex", "Codex", MISSING("Codex", "codex"));

type Seed = { providers: Provider[]; login?: Record<string, Login>; repair?: string };

const SEEDS = {
  "fresh install": { providers: [claudeMissing, codexMissing] },
  "installing…": {
    providers: [claudeMissing, codexMissing],
    login: { codex: { state: "opening" } },
  },
  "console open": {
    providers: [claudeMissing, codexMissing],
    login: { codex: { state: "open", probedAt: "2026-10-13T09:00:00.000Z" } },
  },
  "console failed": {
    providers: [claudeMissing, codexMissing],
    login: {
      codex: {
        state: "failed",
        message: "Could not open the Codex installer console: spawn cmd.exe ENOENT",
      },
    },
  },
  "installed, signed out": {
    providers: [
      provider("claude", "Claude Code", SIGNED_OUT("Claude Code")),
      provider("codex", "Codex", SIGNED_OUT("Codex")),
    ],
    login: { claude: { state: "open", probedAt: "2026-10-13T09:00:00.000Z" } },
  },
  "login expired": {
    providers: [
      provider("claude", "Claude Code", { state: "ready" }),
      provider("codex", "Codex", {
        state: "refused",
        step: "signed-in",
        message: "Codex sign-in expired. Sign in again.",
      }),
    ],
    repair: "codex",
  },
} satisfies Record<string, Seed>;

type SeedName = keyof typeof SEEDS;

const noop = () => {};
const seeded = (seed: Seed): ProvidersState =>
  ({
    list: seed.providers,
    access: { guarded: true },
    error: undefined,
    login: seed.login ?? {},
    probe: noop,
    openLogin: noop,
    setAccess: noop,
    add: noop,
    remove: noop,
  }) as unknown as ProvidersState;

export function FirstRunSeedsDemo() {
  const [name, setName] = useState<SeedName>("fresh install");
  const seed: Seed = SEEDS[name];
  const providers = seeded(seed);
  const repairing = seed.repair ? seed.providers.find((item) => item.id === seed.repair) : undefined;
  return (
    <Demo
      label="First run · provider repair"
      consumers="chat/composer.tsx (first-open card and selected-provider repair), machine/pea.tsx"
      spec="A brand-new install reaches a working turn through the composer alone: the card names what each harness lacks and its one press; a press says what it is doing under its row; a failure names its reason. A login that expires mid-session reads expired on the selected provider, with its repair beside Send."
    >
      <Switcher
        ariaLabel="first-run seed"
        value={name}
        onChange={setName}
        options={(Object.keys(SEEDS) as SeedName[]).map((value) => ({
          value,
          label: value,
          title: `the ${value} moment`,
        }))}
      />
      <div data-surface="page" className="w-[520px]">
        {repairing ? (
          <ProviderRepair provider={repairing} providers={providers} />
        ) : (
          <FirstOpenCard providers={providers} origin="http://127.0.0.1:5180" />
        )}
      </div>
    </Demo>
  );
}

const UPDATE_SEEDS = [
  "no-revit",
  "blocked-plan",
  "waiting-plan",
  "update-downloading",
  "receipt-handoff",
  "update-failed",
  "update-check-failed",
] as const;

/** The seven update states, drawn from the one persisted fact, at the tray's 380 px. */
export function UpdateStatesDemo() {
  const [name, setName] = useState<(typeof UPDATE_SEEDS)[number] | "checking">("waiting-plan");
  const checking = name === "checking";
  const reading = MACHINE_SEEDS[checking ? "no-revit" : name];
  return (
    <Demo
      label="Update states"
      consumers="machine/update.tsx (Update group), machine/body.tsx (group state), machine/install-scrim.tsx"
      spec="idle, checking, available, ready, downloading, applying, failed: one pure derivation (machine/update-state.ts) over the host's persisted plan and receipt. A download is the first leg of an admitted apply."
    >
      <Switcher
        ariaLabel="update seed"
        value={name}
        onChange={setName}
        options={[...UPDATE_SEEDS, "checking" as const].map((value) => ({
          value,
          label: value,
          title: `the ${value} moment`,
        }))}
      />
      <div data-surface="page" className="w-[380px] px-3 py-2">
        {checking ? (
          <UpdateGroup reading={reading} fixture checking />
        ) : (
          <MachineBody key={name} reading={reading} fixture shell="tray" group="update" />
        )}
      </div>
    </Demo>
  );
}
