import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";

import { HelpTip } from "#/components/lang/help";
import { keyMeta } from "#/route/keys";
import { ActionChrome } from "#/components/lang/action-button";
import { tv, type VariantProps } from "#/lib/tv";

export type PaneKind = "navigation" | "visual" | "content" | "inspector";

export type PaneShortcut = UseHotkeyDefinition & {
  label: string;
  /** One sentence for the help page. Defaults to the label. */
  says?: string;
  /** The sentence the key refuses with right now; the key fires, the card speaks, nothing runs. */
  refusal?: string | null;
};

export const paneRecipe = tv({
  slots: {
    root: "relative flex size-full min-h-0 min-w-0 flex-col overflow-visible outline-none",
    // A pane body is a COLUMN, so a call site that docks a region under a scroller does not need
    // a second scroller to get one (annotation round, 2026-08-31 — two stacked bars in the right
    // sidebar were a pane body scrolling around a child that also scrolled).
    body: "flex min-h-0 min-w-0 flex-1 flex-col",
  },
  variants: {
    kind: {
      navigation: { body: "overflow-y-auto" },
      visual: { body: "relative overflow-hidden" },
      content: { body: "overflow-auto" },
      inspector: { body: "overflow-y-auto p-2" },
    },
    scroll: {
      auto: { body: "overflow-auto" },
      clip: { body: "overflow-hidden" },
      visible: { body: "overflow-visible" },
    },
  },
});

export interface PaneProps extends Pick<VariantProps<typeof paneRecipe>, "scroll"> {
  kind: PaneKind;
  id?: string;
  shortcuts?: readonly PaneShortcut[];
  headerSurface?: "page" | "artifact" | "recess" | "document";
  title?: ReactNode;
  /**
   * A SHORT machine fact about what the pane is showing — a count, a mode word, a key. It
   * renders truncated on one line beside the title. Meta that cannot fit is not meta: prose
   * that orients the region belongs in `help` (ruled at the annotation round, 2026-08-31 —
   * a header that overflows is the primitive's defect, not the call site's).
   */
  meta?: ReactNode;
  /** Region orientation, one hover away. Renders as the header's `HelpTip`. */
  help?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function Pane({
  kind,
  id,
  shortcuts = [],
  headerSurface,
  title,
  meta,
  help,
  actions,
  toolbar,
  scroll,
  children,
}: PaneProps) {
  const hasHeader = title != null || meta != null || help != null || actions != null;
  const { root, body } = paneRecipe({ kind, scroll });
  const rootRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [cardPosition, setCardPosition] = useState({ top: 0, left: 0, tabLeft: 0 });

  const revealShortcuts = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCardVisible(true);
    timerRef.current = setTimeout(() => setCardVisible(false), 4000);
  }, []);

  // Every pane key is a registration with the shared meta, so the help page can hang it off this
  // region. A refused key fires and reveals the card instead of running — the same posture as a
  // refused route chord, never a silent ignore.
  const bound: UseHotkeyDefinition[] = shortcuts.map((s) => ({
    ...s,
    callback: s.refusal ? () => revealShortcuts() : s.callback,
    options: {
      ...s.options,
      meta: keyMeta({
        name: s.label,
        description: s.says ?? s.label,
        tier: "pane",
        region: id ?? kind,
        refusal: s.refusal ?? null,
      }),
    },
  }));
  useHotkeys(bound, { target: rootRef });


  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!active || shortcuts.length === 0) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 224;
      const rightFits = window.innerWidth - rect.right > width + 16;
      const height = cardRef.current?.offsetHeight ?? 120;
      setCardPosition({
        top: Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 4)),
        left: rightFits ? rect.right + 7 : Math.max(8, rect.left - width - 7),
        tabLeft: rightFits ? rect.right + 1 : Math.max(2, rect.left - 9),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [active, cardVisible, shortcuts.length]);

  const activate = (event: FocusEvent<HTMLElement>) => {
    const owner = (event.target as HTMLElement).closest<HTMLElement>("[data-slot='pane']");
    if (owner !== event.currentTarget) {
      setActive(false);
      setCardVisible(false);
      return;
    }
    if (!active || !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setActive(true);
      if (shortcuts.length > 0) revealShortcuts();
    }
  };

  const deactivate = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setActive(false);
    setCardVisible(false);
  };

  return (
    <section
      ref={rootRef}
      data-slot="pane"
      data-kind={kind}
      data-pane-id={id}
      data-has-shortcuts={shortcuts.length > 0 || undefined}
      data-active={active}
      data-surface={kind === "visual" ? "artifact" : "page"}
      tabIndex={-1}
      onFocusCapture={activate}
      onBlurCapture={deactivate}
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        const focusable = target.closest<HTMLElement>(
          "a,button,input,select,textarea,[contenteditable='true'],[tabindex]",
        );
        if (!focusable || focusable === event.currentTarget) event.currentTarget.focus();
      }}
      className={`${root()} ${active ? "z-raised" : ""}`}
    >
      <span
        aria-hidden="true"
        data-slot="pane-halo"
        className={`pointer-events-none absolute -inset-1 z-notice border-[3px] border-line-2 transition-[clip-path,opacity] duration-control motion-reduce:transition-none ${
          active ? "opacity-100 [clip-path:inset(0)]" : "opacity-0 [clip-path:inset(0_100%_0_0)]"
        }`}
      />
      {hasHeader && (
        <div
          data-slot="pane-header"
          data-surface={headerSurface}
          className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2"
        >
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {title != null && <h2 className="t-small t-upper min-w-0 truncate">{title}</h2>}
            {meta != null && (
              <span
                title={typeof meta === "string" ? meta : undefined}
                className="face-mono min-w-0 truncate text-ink-2"
              >
                {meta}
              </span>
            )}
            {help != null && (
              <span className="shrink-0 self-center">
                <HelpTip>{help}</HelpTip>
              </span>
            )}
          </div>
          {actions != null && (
            <div data-slot="pane-actions" className="flex shrink-0 items-center gap-0.5">
              {/* A header is chrome: a verb's refusal hovers, it does not wrap (see `ActionChrome`). */}
              <ActionChrome value>{actions}</ActionChrome>
            </div>
          )}
        </div>
      )}
      {toolbar != null && (
        <div
          data-slot="pane-toolbar"
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1"
        >
          {toolbar}
        </div>
      )}
      <div data-slot="pane-body" className={body()}>
        {children}
      </div>

      {active && shortcuts.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <>
              <aside
                ref={cardRef}
                data-slot="pane-shortcuts"
                data-visible={cardVisible}
                data-surface="artifact"
                aria-label={`${id ?? kind} keyboard shortcuts`}
                style={{ top: cardPosition.top, left: cardPosition.left }}
                className={`fixed z-popup w-56 border border-line-2 text-ink shadow-float transition-[opacity,transform] duration-control motion-reduce:transition-none ${
                  cardVisible
                    ? "translate-y-0 opacity-100"
                    : "pointer-events-none -translate-y-1 opacity-0"
                }`}
              >
                <div className="t-small t-upper flex items-center justify-between border-b border-line px-2.5 py-2 text-ink-2">
                  <span>{id ?? kind} keys</span>
                  <span>4s</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 p-2.5">
                  {shortcuts.map((shortcut, index) => {
                    const enabled = shortcut.options?.enabled !== false;
                    return (
                      <div
                        key={`${index}:${shortcut.label}`}
                        data-slot="pane-shortcut"
                        data-enabled={enabled}
                        className={enabled ? "contents" : "contents text-ink-mute"}
                      >
                        <kbd
                          data-surface="recess"
                          className="face-mono t-small min-w-7 border border-line-2 px-1.5 py-0.5 text-center"
                        >
                          {typeof shortcut.hotkey === "string" ? shortcut.hotkey : "custom"}
                        </kbd>
                        <span className="whitespace-nowrap">{shortcut.label}
                          {shortcut.refusal ? <span className="text-ink-mute"> — {shortcut.refusal}</span> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </aside>
              <button
                type="button"
                data-slot="pane-shortcuts-tab"
                data-surface="artifact"
                aria-label={`Show ${id ?? kind} keyboard shortcuts`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={revealShortcuts}
                style={{ top: Math.max(8, cardPosition.top + 4), left: cardPosition.tabLeft }}
                className={`face-mono t-small fixed z-popup border border-line-2 px-1 py-2 text-ink [writing-mode:vertical-rl] ${
                  cardVisible ? "hidden" : "block"
                }`}
              >
                ? keys
              </button>
            </>,
            document.body,
          )
        : null}
    </section>
  );
}

export { PaneSplit } from "./pane-resize";
export type { PaneCollapseSpec, PaneSizeSpec, PaneSplitProps } from "./pane-resize";
export { PaneWorkspace } from "./pane-workspace";
export type { PaneWorkspaceProps } from "./pane-workspace";
