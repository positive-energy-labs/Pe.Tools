import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { routeAddress, type ThreadTab } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";

export function tabTitle(tab: ThreadTab) {
  const at = routeAddress(tab.route);
  const { page } = at.read(
    Object.fromEntries(new URL(tab.link, "http://tab.invalid").searchParams),
  );
  const subject =
    "system" in page
      ? page.system
      : "path" in page
        ? page.path
        : "schedule" in page
          ? page.schedule
          : "query" in page
            ? page.query
            : "";
  return `${at.title}${typeof subject === "string" && subject ? ` · ${subject}` : ""}`;
}

/** Each button names one durable Place; the route body is the existing standalone outlet. */
export function RouteTabs({
  tabs,
  active,
  failure,
  onRetry,
  onSelect,
  onClose,
  onChat,
  onDuplicate,
  onCloseActive,
  children,
}: {
  tabs: readonly ThreadTab[];
  active: string | null;
  failure: string | null;
  onRetry: () => void;
  onSelect: (tab: ThreadTab) => void;
  onClose: (tab: ThreadTab) => void;
  onChat: () => void;
  onDuplicate: (() => void) | null;
  onCloseActive: () => void;
  /** The dock's own controls, at the strip's far end. */
  children?: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto hairline-b px-2 py-1"
      aria-label="Thread Places"
    >
      {failure && tabs.length === 0 && (
        <Button label="Discard unavailable link and open chat" onClick={onChat}>
          Open chat
        </Button>
      )}
      {tabs.map((tab) => (
        <div key={tab.id} className="flex shrink-0 items-center">
          <TooltipHint content={tab.link}>
            <Button
              label={tabTitle(tab)}
              aria-pressed={active === tab.id}
              onClick={() => onSelect(tab)}
            >
              {tabTitle(tab)}
            </Button>
          </TooltipHint>
          <Button icon={X} label={`Close ${tabTitle(tab)}`} onClick={() => onClose(tab)} />
        </div>
      ))}
      {active && !tabs.some((tab) => tab.id === active) && (
        <>
          <span data-tone="caution">Place not saved</span>
          <Button icon={X} label="Close unsaved Place" onClick={onCloseActive} />
        </>
      )}
      {onDuplicate && (
        <Button icon={Plus} label="Open another Place on this route" onClick={onDuplicate} />
      )}
      {failure && (
        <>
          <span role="status" data-tone="caution">
            {failure}
          </span>
          <Button label="Retry saving Places" onClick={onRetry}>
            Retry
          </Button>
        </>
      )}
      {children}
    </div>
  );
}
