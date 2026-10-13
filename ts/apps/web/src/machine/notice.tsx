/**
 * The tray's notice card, mounted once at the root on the tray surface. The host projects receipt
 * revisions onto `/host/notices`; the tray shim hands each card to `window.peNotice` and lends its
 * window card-sized without taking focus. Card messages ride the tray's string-JSON `type` protocol
 * (`notice-card`/`notice-hide`/`notice-panel`); opening an href is the surface's own `open-window`. The
 * card settles nothing: a permission reply goes to the thread's own door, which stays the reply
 * authority, and the card closes only when that door accepts. The card reports its height and
 * says when it is done. Hover holds it; eight seconds otherwise.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Machine, MachineNotice, Reading } from "@pe/agent-contracts";

import { Button } from "#/components/lang/button";
import { OutcomeLine } from "#/components/lang/outcome";
import { Row } from "#/components/lang/row";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { useSurfaceHost } from "#/navigation/surface-host";

import { AutomaticUpdates } from "./update";

declare global {
  interface Window {
    peNotice?: (notice: MachineNotice | null) => void;
    chrome?: { webview?: { postMessage(message: string): void } };
  }
}

type TrayMessage =
  | { type: "notice-card"; height: number }
  | { type: "notice-hide" }
  | { type: "notice-panel" };
const tray = (message: TrayMessage) => window.chrome?.webview?.postMessage(JSON.stringify(message));

export const NOTICE_HOLD_MS = 8_000;

export function NoticeCard({ reading, fixture }: { reading: Reading<Machine>; fixture: boolean }) {
  const [notice, setNotice] = useState<MachineNotice | null>(null);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const host = useSurfaceHost();
  useEffect(() => {
    window.peNotice = (next) => {
      setError(null);
      setNotice(next);
    };
    return () => void delete window.peNotice;
  }, []);
  useEffect(() => {
    if (!notice || held) return;
    const timer = setTimeout(() => {
      setNotice(null);
      tray({ type: "notice-hide" });
    }, NOTICE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [notice, held]);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      tray({ type: "notice-card", height: Math.ceil(element.getBoundingClientRect().height) }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [notice]);
  if (!notice) return null;
  const close = (message: TrayMessage) => {
    setNotice(null);
    tray(message);
  };
  const open = () =>
    close(
      notice.href && host.openFullWindow(notice.href)
        ? { type: "notice-hide" }
        : { type: "notice-panel" },
    );
  const act = notice.act;
  return (
    <div
      ref={card}
      role="status"
      aria-label="notice"
      data-surface="artifact"
      className="hairline-b fixed inset-x-0 top-0 z-notice flex flex-col gap-1.5 px-3 py-2"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
    >
      <Row
        role="button"
        tabIndex={0}
        lines={2}
        label={notice.title}
        sub={notice.body}
        title={notice.href ? "open it in the app window" : "open the tray panel"}
        onClick={open}
        onKeyDown={(event) => event.key === "Enter" && open()}
      />
      {act?.kind === "permission" ? (
        <span className="flex flex-wrap gap-1.5">
          {act.options.map((option) => (
            <Button
              key={option.optionId}
              kind={option.kind.startsWith("allow") ? "commit" : "framed"}
              label={option.name}
              reason={
                fixture ? "Fixture: nothing here reaches a host." : `answer Pea: ${option.name}`
              }
              refusal={fixture ? "Fixture: nothing here reaches a host." : null}
              onClick={() =>
                void harnessClient(resolveWorkbenchConfig().origin)
                  .permission(act.threadId, act.requestId, option.optionId)
                  .then(
                    () => close({ type: "notice-hide" }),
                    (caught: unknown) =>
                      setError(`Pea did not take this answer: ${String(caught)}`),
                  )
              }
            >
              {option.name}
            </Button>
          ))}
        </span>
      ) : act?.kind === "automatic-updates" ? (
        <AutomaticUpdates reading={reading} fixture={fixture} />
      ) : null}
      {error ? <OutcomeLine kind="refused" label={error} /> : null}
    </div>
  );
}
