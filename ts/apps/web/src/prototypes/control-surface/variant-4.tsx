/**
 * THROWAWAY protoui variant 4: the tray as one command palette.
 * Fixture-only. Delete with the control-surface lineup after the round.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  CheckCheck,
  CircleAlert,
  FileCheck2,
  Laptop,
  LogOut,
  MessageSquarePlus,
  Play,
  RefreshCw,
  Server,
  Settings2,
  Share2,
  SquareArrowOutUpRight,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@pe/kit/lang/button";
import { KeyHint } from "@pe/kit/lang/key-hint";
import { List } from "@pe/kit/lang/list-popup";
import type { Collection } from "@pe/kit/lang/collection";
import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = {
  id: "4",
  label: "Command palette",
  width: 520,
  height: 600,
};

type Group = "Needs you" | "Running" | "Launch" | "Machine";

type Command = {
  id: string;
  group: Group;
  label: string;
  search: string;
  state: string;
  verb: string;
  icon: LucideIcon;
  tone?: "caution" | "alarm";
  secondary?: readonly string[];
};

const COMMANDS: readonly Command[] = [
  {
    id: "hcb-approval",
    group: "Needs you",
    label: "Review HCB family suggestion",
    search: "hcb suggestion family 12 changes approval",
    state: "12 changes",
    verb: "review",
    icon: FileCheck2,
    tone: "caution",
    secondary: ["open Work", "refuse"],
  },
  {
    id: "approval",
    group: "Needs you",
    label: "Approve level naming plan",
    search: "pea thread waiting approval level naming plan",
    state: "waiting",
    verb: "answer",
    icon: CircleAlert,
    tone: "caution",
    secondary: ["open thread", "refuse"],
  },
  {
    id: "finished",
    group: "Needs you",
    label: "Review ventilation schedule result",
    search: "pea thread finished unread ventilation schedule result",
    state: "finished · unread",
    verb: "open",
    icon: CheckCheck,
    secondary: ["mark read", "archive"],
  },
  {
    id: "failed",
    group: "Needs you",
    label: "Resume failed sheet export",
    search: "pea thread failed sheet export",
    state: "failed",
    verb: "inspect",
    icon: CircleAlert,
    tone: "alarm",
    secondary: ["retry", "open log"],
  },
  {
    id: "hcb-thread",
    group: "Running",
    label: "HCB coordination cleanup",
    search: "hcb pea thread coordination cleanup working",
    state: "working",
    verb: "open",
    icon: Bot,
    secondary: ["steer", "stop"],
  },
  {
    id: "running-thread",
    group: "Running",
    label: "Check terminal unit families",
    search: "pea thread terminal unit families working",
    state: "working",
    verb: "open",
    icon: Bot,
    secondary: ["steer", "stop"],
  },
  {
    id: "revit-2025-session",
    group: "Running",
    label: "Revit 2025 · Central Office",
    search: "revit 2025 session central office controlled",
    state: "controlled",
    verb: "show",
    icon: Server,
    secondary: ["documents", "stop"],
  },
  {
    id: "revit-2024-session",
    group: "Running",
    label: "Revit 2024 · Family Lab",
    search: "revit 2024 session family lab observed",
    state: "observed",
    verb: "show",
    icon: Server,
    secondary: ["documents", "adopt"],
  },
  ...([2024, 2025, 2026] as const).map(
    (year): Command => ({
      id: `launch-revit-${year}`,
      group: "Launch",
      label: `Revit ${year}`,
      search: `launch start revit ${year}`,
      state: "ready",
      verb: "launch",
      icon: Play,
      secondary: ["clean boot"],
    }),
  ),
  {
    id: "new-thread",
    group: "Launch",
    label: "New Pea thread",
    search: "new pea thread chat launch",
    state: "2 providers",
    verb: "new",
    icon: MessageSquarePlus,
    secondary: ["choose provider"],
  },
  {
    id: "small-window",
    group: "Launch",
    label: "Small Pea window",
    search: "small pea window compact launch",
    state: "closed",
    verb: "open",
    icon: SquareArrowOutUpRight,
    secondary: ["always on top"],
  },
  {
    id: "update",
    group: "Machine",
    label: "Update Pe.Tools",
    search: "machine update pe tools 0.7.24 up to date",
    state: "0.7.24 · current",
    verb: "check",
    icon: RefreshCw,
    secondary: ["release notes"],
  },
  {
    id: "share",
    group: "Machine",
    label: "Share this machine",
    search: "machine share refused tailnet",
    state: "refused",
    verb: "inspect",
    icon: Share2,
    tone: "alarm",
    secondary: ["copy reason"],
  },
  {
    id: "providers",
    group: "Machine",
    label: "Providers",
    search: "machine pea providers two ready",
    state: "2 of 2",
    verb: "manage",
    icon: Settings2,
    secondary: ["test all"],
  },
  {
    id: "login",
    group: "Machine",
    label: "Start at login",
    search: "machine host start at login autostart on",
    state: "on",
    verb: "turn off",
    icon: Laptop,
    secondary: ["open Windows settings"],
  },
  {
    id: "quit",
    group: "Machine",
    label: "Quit host",
    search: "machine quit stop host",
    state: "pid 42824",
    verb: "quit",
    icon: LogOut,
    secondary: ["open window"],
  },
];

function SecondaryVerbs({ command, act }: { command: Command; act: (label: string) => void }) {
  return (
    <span className="flex items-center gap-1 py-0.5">
      <span className="mr-1 text-ink-mute">more</span>
      {command.secondary?.map((verb) => (
        <Button key={verb} label={`${verb} ${command.label}`} onClick={() => act(verb)}>
          {verb}
        </Button>
      ))}
      <KeyHint mute>Tab</KeyHint>
    </span>
  );
}

export default function Variant() {
  const frame = useRef<HTMLDivElement>(null);
  const collection = useRef<Collection<Command> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [said, setSaid] = useState<ReactNode>("fixture commands · nothing reaches the host");

  useEffect(() => {
    frame.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
  }, []);

  const act = (command: Command, verb = command.verb) => {
    setSaid(
      <>
        <span className="text-ink">{verb}</span> · {command.label}
      </>,
    );
  };

  return (
    <div
      ref={frame}
      data-surface="page"
      className="flex h-full w-full min-h-0 flex-col font-sans text-ink"
      aria-label="Pe.Tools command palette"
    >
      <List<Command>
        aria-label="Pe.Tools commands"
        items={COMMANDS}
        keyOf={(command) => command.id}
        labelOf={(command) => command.search}
        groupOf={(command) => command.group}
        groupCounts={false}
        filter="substring"
        searchAbove={0}
        searchPlaceholder="Type a command or find work…"
        empty="No commands available"
        noMatch="No commands match"
        maxHeight="100%"
        onCollection={(next) => {
          collection.current = next;
        }}
        onCursorChange={(key) => {
          if (expanded && key !== expanded) setExpanded(null);
        }}
        onTab={() => {
          const key = collection.current?.cursor ?? null;
          if (key) setExpanded((open) => (open === key ? null : key));
          return true;
        }}
        onPick={(command) => act(command)}
        row={(command) => {
          const Icon = command.icon;
          const open = expanded === command.id;
          return {
            lead: <Icon className="size-3.5" aria-hidden />,
            label: command.label,
            lines: open ? 2 : 1,
            sub: open ? (
              <SecondaryVerbs command={command} act={(verb) => act(command, verb)} />
            ) : null,
            failed: command.tone === "alarm",
            meta: (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="face-mono" data-tone={command.tone}>
                  {command.state}
                </span>
                <span className="inline-flex items-center gap-1 text-ink-mute">
                  <KeyHint mute>Enter</KeyHint>
                  {command.verb}
                </span>
              </span>
            ),
          };
        }}
        footer={
          <div className="flex min-h-8 items-center justify-between gap-3 px-1 pb-1 t-small text-ink-2">
            <span className="min-w-0 truncate" role="status">
              {said}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <KeyHint mute>↑↓</KeyHint> move <KeyHint mute>Tab</KeyHint> more
            </span>
          </div>
        }
      />
    </div>
  );
}
