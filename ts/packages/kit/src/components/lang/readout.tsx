import { useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { PaneOverlay } from "./pane";
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
  // Native and non-passive: the picture's wheel listener skips the claimed event.
  const body = useCallback((node: HTMLDivElement | null) => {
    const at = node?.parentElement;
    if (!at) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      node.scrollTop += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    };
    at.addEventListener("wheel", wheel, { passive: false });
    return () => at.removeEventListener("wheel", wheel);
  }, []);
  return (
    <PaneOverlay label="picture readout">
      <section
        className="dl-picture-readout t-small"
        aria-label={selected ? "the selection" : "the picture"}
        data-picture-readout={selected ? "selection" : "picture"}
      >
        {selected ? (
          <header className="hairline-b">
            <span data-readout-title="">{title}</span>
            {onClear ? (
              <Button label="Clear the selection · Esc" icon={X} onClick={onClear} />
            ) : null}
          </header>
        ) : null}
        <div ref={body} data-readout-body="">
          {children}
        </div>
        {foot ? <footer>{foot}</footer> : null}
      </section>
    </PaneOverlay>
  );
}
