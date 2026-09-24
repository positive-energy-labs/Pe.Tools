import { useEffect, useState } from "react";
import { useWorkbench } from "#/workbench/provider";
import { Press } from "#/components/lang/press";
import { Textarea } from "#/components/lang/textarea";
import { readQueue, writeQueue, type Queue } from "./host";

export function QueuedMessages() {
  const { chat, config, currentThreadId, isRunning, turnFailure } = useWorkbench();
  const count = chat.display.queuedFollowUps ?? 0;
  const [queue, setQueue] = useState<Queue>();
  const [error, setError] = useState<string>();
  const [edit, setEdit] = useState<{ id: string; content: string }>();
  const url = `${config.origin}/pe/thread/${encodeURIComponent(currentThreadId)}/queue`;
  useEffect(() => {
    setQueue(undefined);
    setEdit(undefined);
    setError(undefined);
  }, [url]);
  // The stream reports every queue change: the count, a run ending (paused), a drain refusal.
  useEffect(() => {
    if (!count) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const next = await readQueue(url, abort.signal);
        if (!abort.signal.aborted) setQueue(next);
      } catch (error) {
        if (!abort.signal.aborted) setError(String(error));
      }
    })();
    return () => abort.abort();
  }, [url, count, isRunning, turnFailure]);
  const change = async (command: object) => {
    try {
      setQueue(await writeQueue(url, command));
      setEdit(undefined);
      setError(undefined);
    } catch (error) {
      setError(String(error));
    }
  };
  if (!count) return null;
  return (
    <section aria-label="Queued messages" className="hairline-b px-3 py-2 t-small">
      <div className="flex items-center gap-2">
        <span role="status">
          {count} queued{queue?.paused ? " · paused" : " · after this turn"}
        </span>
        {queue?.paused ? (
          <Press type="button" tone="quiet" onClick={() => void change({ action: "resume" })}>
            resume queue
          </Press>
        ) : null}
      </div>
      {queue?.items.map((item) => (
        <div key={item.id} className="flex items-start gap-2 py-1">
          {edit?.id === item.id ? (
            <div className="min-w-0 flex-1">
              <Textarea
                aria-label="Edit queued message"
                value={edit.content}
                onChange={(event) => setEdit({ ...edit, content: event.target.value })}
              />
              <Press
                type="button"
                tone="quiet"
                disabled={!edit.content.trim()}
                onClick={() => void change({ action: "edit", ...edit })}
              >
                save
              </Press>
              <Press type="button" tone="quiet" onClick={() => setEdit(undefined)}>
                cancel edit
              </Press>
            </div>
          ) : (
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
              {item.content}
              {item.attachments ? ` · ${item.attachments} attachments` : ""}
            </span>
          )}
          <Press
            type="button"
            tone="quiet"
            onClick={() => setEdit({ id: item.id, content: item.content })}
          >
            edit
          </Press>
          <Press
            type="button"
            tone="quiet"
            onClick={() => void change({ action: "remove", id: item.id })}
          >
            remove
          </Press>
        </div>
      ))}
      {(error ?? queue?.error) ? <p role="alert">{error ?? queue?.error}</p> : null}
    </section>
  );
}
