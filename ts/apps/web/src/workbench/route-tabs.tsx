import { Plus, X } from "lucide-react";
import { routeAddress, type ThreadTab } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import "./route-tabs.css";

function tabTitle(tab: ThreadTab) {
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

const TAB_CH = 24;

/** The tools pane's header: one labelled tab per durable Place, none pressed while collapsed. Each
 *  Place carries its own named close, shown on hover or focus so the collapsed bar stays a row of
 *  words; it stays in the tab order. */
export function RouteTabs({
  tabs,
  active,
  onSelect,
  onClose,
}: {
  tabs: readonly ThreadTab[];
  active: string | null;
  onSelect: (tab: ThreadTab) => void;
  onClose: (tab: ThreadTab) => void;
}) {
  return (
    <span role="group" aria-label="Thread Places" className="flex min-w-0 shrink items-center">
      {tabs.map((tab) => {
        const name = tabTitle(tab);
        return (
          <span
            key={tab.id}
            // Layout and the hover-revealed close live in route-tabs.css.
            className="flex min-w-0 items-center"
          >
            {/* A hint only when the label is cut. ponytail: the cut is guessed from length
                against the 24ch cap; measure the span on reach if wide glyphs ever cut a
                shorter name. */}
            <TooltipHint content={name.length > TAB_CH ? name : ""}>
              <Button label={name} pressed={active === tab.id} onClick={() => onSelect(tab)}>
                <span className="block min-w-0 truncate" style={{ maxWidth: `${TAB_CH}ch` }}>
                  {name}
                </span>
              </Button>
            </TooltipHint>
            <Button icon={X} label={`Close ${name}`} onClick={() => onClose(tab)} />
          </span>
        );
      })}
    </span>
  );
}

/** Verbs on the shown Place, and the strip's refusal when Places cannot be saved. */
export function RouteTabActions({
  tabs,
  active,
  failure,
  onRetry,
  onChat,
  onDuplicate,
  onCloseActive,
}: {
  tabs: readonly ThreadTab[];
  active: string | null;
  failure: string | null;
  onRetry: () => void;
  onChat: () => void;
  onDuplicate: (() => void) | null;
  onCloseActive: () => void;
}) {
  return (
    <>
      {failure && (
        <>
          <span role="status" data-tone="caution" className="t-small min-w-0 truncate">
            {failure}
          </span>
          <Button label="Retry saving Places" onClick={onRetry}>
            Retry
          </Button>
          {tabs.length === 0 && (
            <Button label="Discard unavailable link and open chat" onClick={onChat}>
              Open chat
            </Button>
          )}
        </>
      )}
      {active && !tabs.some((tab) => tab.id === active) && (
        <>
          <span data-tone="caution" className="t-small">
            Place not saved
          </span>
          <Button icon={X} label="Close unsaved Place" onClick={onCloseActive} />
        </>
      )}
      {onDuplicate && (
        <Button icon={Plus} label="Open another Place on this route" onClick={onDuplicate} />
      )}
    </>
  );
}
