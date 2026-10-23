import { useCallback, useContext, useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { PaneOverlay, PictureReadoutContext } from "./pane";
import { Button } from "./button";
import "./lang.css";

/** Selection replaces the summary in one dock; clearing it never owns a viewport move. */
export function PictureReadout({
  subject,
  title,
  onClear,
  children,
  foot,
}: {
  /** The picture's named subject, retained above an individual selection in the pane crumb. */
  subject?: ReactNode;
  title?: ReactNode;
  onClear?: () => void;
  children: ReactNode;
  foot?: ReactNode;
}) {
  const register = useContext(PictureReadoutContext);
  useEffect(() => register?.({ subject, title, onClear }), [register, subject, title, onClear]);
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
        <header className={selected ? "hairline-b" : undefined}>
          <span data-readout-title="">{title}</span>
          {selected && onClear ? (
            <Button label="Clear the selection · Esc" icon={X} onClick={onClear} />
          ) : null}
        </header>
        <div ref={body} data-readout-body="">
          {children}
        </div>
        {foot ? <footer>{foot}</footer> : null}
      </section>
    </PaneOverlay>
  );
}
