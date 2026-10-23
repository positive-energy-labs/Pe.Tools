import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useScopeKeys } from "../../keys";
import { Button } from "./button";
import "./lang.css";

/** Selection replaces the summary in one dock; clearing it never owns a viewport move. */
export function PictureReadout({
  title,
  onClear,
  children,
  foot,
}: {
  title?: ReactNode;
  onClear?: () => void;
  children: ReactNode;
  foot?: ReactNode;
}) {
  const selected = title != null;
  const body = useRef<HTMLDivElement>(null);
  useScopeKeys([
    {
      hotkey: "Escape",
      label: "clear the selection",
      available: () => selected && onClear != null,
      callback: () => onClear?.(),
    },
  ]);
  // Native and non-passive: the picture's wheel listener skips the claimed event.
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
      className="dl-picture-readout hairline t-small"
      aria-label={selected ? "the selection" : "the system"}
      data-surface="page"
      data-slot="pane-dock"
      data-picture-readout={selected ? "selection" : "system"}
    >
      {selected ? (
        <header className="hairline-b">
          <span data-readout-title="">{title}</span>
          {onClear ? <Button label="Clear the selection · Esc" icon={X} onClick={onClear} /> : null}
        </header>
      ) : null}
      <div ref={body} data-readout-body="">
        {children}
      </div>
      {foot ? <footer>{foot}</footer> : null}
    </section>
  );
}
