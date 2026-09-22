import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type Key,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { HelpTip } from "#/components/lang/help";
import { Kbd } from "#/components/lang/kbd";
import { keyMeta } from "#/route/keys";
import { Press } from "#/components/lang/press";
import { tv, type VariantProps } from "#/lib/tv";

import { Rail } from "./rail";

export type PaneKind = "navigation" | "visual" | "content" | "inspector" | "flank";

export type PaneShortcut = UseHotkeyDefinition & {
  label: string;
  /** One sentence for the help page. Defaults to the label. */
  says?: string;
  /** The sentence the key refuses with right now; the key fires, the card speaks, nothing runs. */
  refusal?: string | null;
};

export const paneRecipe = tv({
  slots: {
    root: "relative flex size-full min-h-0 min-w-0 flex-col overflow-visible",
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
      inspector: { body: "overflow-y-auto" },
      flank: { body: "overflow-y-auto" },
    },
    scroll: {
      auto: { body: "overflow-auto" },
      clip: { body: "overflow-hidden" },
      visible: { body: "overflow-visible" },
    },
    flush: {
      false: { body: "p-(--gutter)" },
      true: { body: "p-0" },
    },
  },
  defaultVariants: { flush: false },
});

export interface PaneProps extends Pick<VariantProps<typeof paneRecipe>, "flush" | "scroll"> {
  kind: PaneKind;
  id?: string;
  shortcuts?: readonly PaneShortcut[];
  headerSurface?: "page" | "recess";
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
  /** Default chrome is a rail. Set only when this pane intentionally has no header. */
  headerless?: boolean;
  side?: "left" | "right";
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  boundary?: boolean;
  /** Change this when the child changes target so an old error cannot mask the new target. */
  boundaryKey?: Key;
  onRetry?: () => void;
  /** The focus edge: the pane gained focus from outside. A stage revalidates what it draws here. */
  onActivate?: () => void;
  /** Take focus when revealed, so a pane a stage verb opened owns the keys at once. */
  focusOnMount?: boolean;
  children: ReactNode;
}

class PaneErrorBoundary extends Component<
  { children: ReactNode; what?: ReactNode; onRetry?: () => void },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.failed)
      return (
        <PaneError
          what={this.props.what}
          message={this.state.message}
          retry={() => {
            this.setState({ failed: false, message: "" });
            this.props.onRetry?.();
          }}
        />
      );
    return this.props.children;
  }
}

function PaneLoading({ what }: { what?: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-1 items-center justify-center t-small t-upper text-ink-mute"
    >
      {what != null ? <>loading {what}…</> : "loading…"}
    </div>
  );
}

function PaneError({
  what,
  message,
  retry,
}: {
  what?: ReactNode;
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-2">
      <span className="t-small t-upper" data-tone="alarm">
        {what ?? "pane"} failed to load
      </span>
      <span className="text-ink-2">{message}</span>
      <Press frame="line" size="value" onClick={retry}>
        retry
      </Press>
    </div>
  );
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
  headerless = false,
  flush,
  scroll,
  side = "left",
  collapsed = false,
  onCollapsedChange,
  boundary = true,
  boundaryKey,
  onRetry,
  onActivate,
  focusOnMount = false,
  children,
}: PaneProps) {
  const collapsedFlank = kind === "flank" && collapsed;
  const { root, body } = paneRecipe({ kind, scroll, flush });
  const rootRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [cardPosition, setCardPosition] = useState({ top: 0, left: 0, tabLeft: 0 });

  const revealShortcuts = useCallback(() => {
    setCardVisible(true);
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

  useEffect(() => {
    if (!cardVisible) return;
    const timer = setTimeout(() => setCardVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [cardVisible]);

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
        tabLeft: rightFits ? rect.right + 1 : Math.max(2, rect.left - 7),
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
      onActivate?.();
      if (shortcuts.length > 0) revealShortcuts();
    }
  };

  useEffect(() => {
    if (focusOnMount) rootRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on reveal
  }, []);

  const deactivate = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setActive(false);
    setCardVisible(false);
  };

  const content = boundary ? (
    <PaneErrorBoundary key={boundaryKey} what={title} onRetry={onRetry}>
      <Suspense fallback={<PaneLoading what={title} />}>{children}</Suspense>
    </PaneErrorBoundary>
  ) : (
    children
  );

  return (
    <section
      ref={rootRef}
      data-slot="pane"
      data-kind={kind}
      data-pane-id={id}
      data-has-shortcuts={shortcuts.length > 0 || undefined}
      data-active={active}
      data-help-visible={cardVisible || undefined}
      data-surface={kind === "visual" ? "artifact" : "page"}
      aria-label={typeof title === "string" ? title : undefined}
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
      className={`${root()} ${collapsedFlank ? "w-10 shrink-0" : ""} ${active ? "z-sticky outline outline-line-2" : "outline outline-transparent"} ${cardVisible ? "outline-2 outline-ink-mute" : ""} outline-offset-2 transition-[outline-color] duration-control motion-reduce:transition-none`}
    >
      {collapsedFlank ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 py-2">
          <Press
            size="icon"
            aria-label={`Expand ${typeof title === "string" ? title : "pane"}`}
            onClick={() => onCollapsedChange?.(false)}
          >
            {side === "left" ? <ChevronRight /> : <ChevronLeft />}
          </Press>
          {title != null ? (
            <span data-slot="pane-title" className="t-small t-upper [writing-mode:vertical-rl]">
              {title}
            </span>
          ) : null}
        </div>
      ) : (
        <>
          {!headerless && (
            <div data-slot="pane-header" className="shrink-0">
              <Rail
                ground={headerSurface ?? "page"}
                lead={
                  <>
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
                  </>
                }
                trail={
                  actions != null ? (
                    <div data-slot="pane-actions" className="flex shrink-0 items-center gap-0.5">
                      {actions}
                    </div>
                  ) : undefined
                }
              />
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
            {content}
          </div>
        </>
      )}

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
                        <Kbd mute={!enabled}>
                          {typeof shortcut.hotkey === "string" ? shortcut.hotkey : "custom"}
                        </Kbd>
                        <span className="whitespace-nowrap">
                          {shortcut.label}
                          {shortcut.refusal ? (
                            <span className="text-ink-mute"> — {shortcut.refusal}</span>
                          ) : null}
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
                title={`${id ?? kind} keyboard shortcuts`}
                style={{ top: Math.max(8, cardPosition.top + 4), left: cardPosition.tabLeft }}
                className={`fixed z-popup h-8 w-1.5 border border-line-2 p-0 ${
                  cardVisible ? "hidden" : "block"
                }`}
              >
                <span className="sr-only">keys</span>
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
