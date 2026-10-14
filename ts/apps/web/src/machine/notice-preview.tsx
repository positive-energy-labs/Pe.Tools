import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@pe/kit/lang/hover-card";
import { Button } from "@pe/kit/lang/button";

import { Markdown } from "#/workbench/prose";

/** The native card grows upward; its shell remains the anchor at the taskbar corner. */
export function NoticePreview({
  title,
  body,
  anchor,
  onOpen,
  onSize,
}: {
  title: string;
  body: string;
  anchor: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onSize: (height: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [heightLimit, setHeightLimit] = useState<number>();
  useLayoutEffect(() => {
    if (!open || !popup) return;
    let frame = 0;
    setReady(false);
    const measure = () => {
      onSize(Math.ceil(popup.getBoundingClientRect().height) + 8);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setReady(popup.getBoundingClientRect().top >= 0));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(popup);
    const resized = () => {
      // PositionCard clamps to the work area; fit inside the bounds it actually supplied.
      setHeightLimit(
        Math.min(
          320,
          Math.max(
            0,
            window.innerHeight - (anchor.current?.getBoundingClientRect().height ?? 0) - 8,
          ),
        ),
      );
      measure();
    };
    window.addEventListener("resize", resized);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resized);
      cancelAnimationFrame(frame);
    };
  }, [open, popup, anchor, onSize]);
  return (
    <HoverCard
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          onSize(0);
          setHeightLimit(undefined);
        }
      }}
    >
      <HoverCardTrigger
        delay={350}
        closeDelay={200}
        className="t-small min-w-0 grow truncate text-left"
        aria-label={title}
      >
        {title}
      </HoverCardTrigger>
      <HoverCardContent
        anchor={anchor}
        side="top"
        align="end"
        sideOffset={8}
        collisionAvoidance={{ side: "none", align: "none" }}
        collisionPadding={0}
        positionerClassName="z-notice"
        ref={setPopup}
        data-surface="artifact"
        data-notice-preview=""
        aria-label={`Response · ${title}`}
        className="hairline t-small max-h-80 w-[min(420px,100vw)] overflow-auto rounded-lg p-3"
        style={
          {
            "--type-prose-size": "var(--type-small-size)",
            "--type-prose-line-height": "var(--type-small-line-height)",
            // A WebView cannot paint the preview until native bounds have caught up.
            visibility: ready ? undefined : "hidden",
            maxHeight: heightLimit,
          } as CSSProperties
        }
      >
        <Markdown text={body} />
        <Button kind="framed" label="Open thread" onClick={onOpen}>
          Open thread
        </Button>
      </HoverCardContent>
    </HoverCard>
  );
}
