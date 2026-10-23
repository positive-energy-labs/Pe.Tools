import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./button.css";
/** A row of controls yields labels before icons and never wraps. */
export function ButtonGroup({ children, label }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = ref.current!;
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      group.removeAttribute("data-icon-labels");
      const buttons = [...group.querySelectorAll<HTMLElement>(".dl-button")];
      const control = parseFloat(getComputedStyle(group).getPropertyValue("--control-h"));
      const gap = parseFloat(getComputedStyle(group).gap) || 0;
      // Allow one control's label room per button before reducing glyph-bearing buttons to icons.
      group.toggleAttribute(
        "data-icon-labels",
        control > 0 &&
          group.clientWidth < buttons.length * control * 2 + Math.max(0, buttons.length - 1) * gap,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    for (let parent = group.parentElement; parent; parent = parent.parentElement)
      observer.observe(parent);
    measure();
    return () => observer.disconnect();
  }, [children]);
  return (
    <div
      ref={ref}
      className="dl-button-group"
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}
