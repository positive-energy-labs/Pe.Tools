import { selectQueued } from "#/workbench/chat-state";
import { useWorkbench } from "#/workbench/provider";

/** The prompts the host holds behind the running turn, in send order. */
export function QueuedMessages() {
  const queued = selectQueued(useWorkbench().chat);
  if (!queued.length) return null;
  return (
    <section aria-label="Queued messages" className="hairline-b px-3 py-1 t-small text-ink-2">
      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto py-2">
        {queued.map((item) => (
          <div
            key={item.turnId}
            className="ml-auto flex w-fit max-w-[76%] min-w-0 flex-col items-end gap-1.5"
          >
            <span role="status" className="t-small text-ink-2">
              You · Queued · after this turn
            </span>
            <div
              className="boundary-l px-3 py-1.5 t-prose whitespace-pre-wrap break-words text-ink-2"
              data-surface="recess"
            >
              {item.text}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
