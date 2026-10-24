import { tv } from "../../lib/tv";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Rail } from "./rail";
import "./lang.css";
/** Retain visited sections, but never mount off-screen work or run it before a paint. */
export function Deferred({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => setReady(true));
        });
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current!);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={ref} data-deferred={ready}>
      {ready && children}
    </div>
  );
}
export const sectionRecipe = tv({
  slots: {
    base: "min-w-0",
    label: "m-0 t-small t-upper",
    aside: "ml-auto flex items-center gap-1.5",
    provenance: "mt-1.5 mb-0 t-small face-mono tracking-[0.02em] text-ink-2",
  },
});
export function Section({
  label,
  help,
  aside,
  children,
}: {
  label: string;
  /** Region orientation — a HelpTip node, beside the title it orients. */
  help?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const slots = sectionRecipe();
  return (
    <section className={slots.base()}>
      <Rail
        lead={
          <>
            <h2 className={slots.label()}>{label}</h2>
            {help}
          </>
        }
        trail={aside != null ? <div className={slots.aside()}>{aside}</div> : undefined}
      />
      {children}
    </section>
  );
}
export function Provenance({ children }: { children: React.ReactNode }) {
  const { provenance } = sectionRecipe();
  return <p className={provenance()}>{children}</p>;
}
