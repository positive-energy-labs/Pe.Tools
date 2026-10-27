/**
 * The review verbs (accept, deny, unstage) in one colour language wherever they draw. Without
 * children the verb is its icon and its kind is its name. The person's commit is a Button, never these.
 */
import type { ComponentProps } from "react";
import { Check, Undo2, X } from "lucide-react";

import "./lang.css";
import "./cell.css";

export type VerdictKind = "take" | "unsuggest" | "clear";

const ICON = { take: Check, unsuggest: X, clear: Undo2 } as const;

export function Verdict({
  kind,
  children,
  type,
  ...props
}: { kind: VerdictKind } & Omit<ComponentProps<"button">, "className" | "title">) {
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
