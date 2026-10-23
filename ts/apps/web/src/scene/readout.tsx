/**
 * The picture's readout, docked top-left: what the picture is about right now. With nothing
 * selected it is the system's summary; with an element selected (a 3D click, a tree or inbox row, a
 * name in prose, the go-to) it is that element's identity, facts and issues, in place.
 * kaitpw 2026-10-23: "the top left summary box should be where selection info shows ... the
 * popovers always felt a little wrong". It never moves, and while an element is selected it holds
 * one size (its body scrolls), so the eye finds the same place every time. Subject framing keeps a
 * subject in the middle half of the picture, clear of it (`subjectPose`).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@pe/kit/lang/button";

export function PictureReadout({
  title,
  onClear,
  children,
  foot,
}: {
  /** The selected element's name; absent, the readout is the system summary. */
  title?: ReactNode;
  onClear?: () => void;
  children: ReactNode;
  /** The way back after a jump. */
  foot?: ReactNode;
}) {
  const selected = title != null;
  const body = useRef<HTMLDivElement>(null);
  // The picture's wheel listener sits on the pane and skips a claimed event: over the readout a
  // wheel scrolls the readout, never the camera. Native and non-passive so the claim can be made.
  useEffect(() => {
    const at = body.current?.parentElement;
    if (!at) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      body.current!.scrollTop += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    };
    at.addEventListener("wheel", wheel, { passive: false });
    return () => at.removeEventListener("wheel", wheel);
  }, []);
  return (
    <section
      aria-label={selected ? "the selection" : "the system"}
      data-surface="page"
      data-slot="pane-dock"
      data-picture-readout={selected ? "selection" : "system"}
      className={`absolute left-2 top-2 flex w-[min(22rem,calc(100%-1rem))] flex-col t-small ${
        selected ? "h-[min(16rem,30%)]" : ""
      }`}
    >
      {selected ? (
        <header className="border-line flex min-w-0 items-center gap-1 border-b pl-1.5">
          <span className="min-w-0 flex-1 truncate font-medium" data-readout-title="">
            {title}
          </span>
          {onClear ? <Button label="Clear the selection · Esc" icon={X} onClick={onClear} /> : null}
        </header>
      ) : null}
      <div ref={body} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 py-1">
        {children}
      </div>
      {foot ? <footer className="px-0.5 pb-0.5">{foot}</footer> : null}
    </section>
  );
}
