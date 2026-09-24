/**
 * The review verbs, one colour language wherever they draw (ruling 30): a grid cell, a Work
 * sentence, a chat proposal group, a tool approval. Each wears the mark it answers: accept takes
 * Pea's proposal (pea ink), unstage clears your own staged edit (caution, its square's colour), deny
 * stays neutral. The person's commit (apply, write) is `ActionButton tone="commit"`, never these.
 * Without children the verb is its icon and its kind is its name.
 */
import type { ComponentProps } from "react";
import { Check, Undo2, X } from "lucide-react";

import "./lang.css";

export type VerdictKind = "accept" | "deny" | "unstage";

const ICON = { accept: Check, deny: X, unstage: Undo2 } as const;

export function Verdict({
  kind,
  children,
  type,
  ...props
}: { kind: VerdictKind } & Omit<ComponentProps<"button">, "className">) {
  const Icon = ICON[kind];
  return (
    <button
      type={type ?? "button"}
      className="dl-verdict"
      data-kind={kind}
      aria-label={children == null ? kind : undefined}
      {...props}
    >
      <Icon />
      {children}
    </button>
  );
}
