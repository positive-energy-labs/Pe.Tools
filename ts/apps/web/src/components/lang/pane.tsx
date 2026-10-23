import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Component, Suspense, useRef, type Key, type ReactNode } from "react";

import { reportFault } from "#/host/diagnostics";


import { Floater } from "#/components/lang/floater";
import { PaneStrip, type PaneStripProps } from "#/components/lang/pane-strip";
import { KeyScope } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import { tv, type VariantProps } from "@pe/kit/lib/tv";

import { Rail } from "@pe/kit/lang/rail";
import "@pe/kit/lang/pane.css";


// A pane is a header, a scrolling body and an error boundary; it is also a key scope, so a child's
// `useScopeKeys` binds while focus is inside it. No `title` and no `tabs` draws no header.
export const paneRecipe = tv({
  slots: {
    root: "relative flex size-full min-h-0 min-w-0 flex-col overflow-visible",
    // A column, so a call site docks a region under a scroller without a second scroller.
    body: "relative flex min-h-0 min-w-0 flex-1 flex-col",
  },
  variants: {
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
  defaultVariants: { scroll: "auto", flush: false },
});

interface PaneProps extends VariantProps<typeof paneRecipe>, PaneStripProps {
  id?: string;
  title?: ReactNode;
  /** The title is the thing shown (a thread, a schedule), drawn as the page heading. */
  name?: boolean;
  /** A short machine fact (a count, a mode word), truncated beside the title. Prose is `help`. */
  meta?: ReactNode;
  help?: ReactNode;
  actions?: ReactNode;
  leadingActions?: ReactNode;
  titleAlign?: "start" | "center";
  /** Pane-view tabs replace the title line; the title stays the accessible name. */
  tabs?: ReactNode;
  /** The pane's ground; the artifact plane draws its own hairline. Default: the page. */
  ground?: "artifact";
  /** Change it when the child changes target, so an old error cannot mask the new one. */
  boundaryKey?: Key;
  onRetry?: () => void;
  children: ReactNode;
}

export class PaneErrorBoundary extends Component<
  { children: ReactNode; what?: ReactNode; onRetry?: () => void },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  // The pane boundary owns its fault; an inner boundary that caught first owns its own.
  componentDidCatch(error: unknown) {
    reportFault({ code: "pane.failed" }, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-2">
        <span className="t-small" data-tone="alarm">
          {this.props.what ?? "pane"} failed to load
        </span>
        <span className="text-ink-2">{this.state.message}</span>
        <Button
          kind="framed"
          label="retry"
          onClick={() => {
            this.setState({ failed: false, message: "" });
            this.props.onRetry?.();
          }}
        >
          retry
        </Button>
      </div>
    );
  }
}

export function Pane({
  id,
  title,
  name = false,
  meta,
  help,
  actions,
  leadingActions,
  titleAlign = "start",
  tabs,
  scroll,
  flush,
  ground,
  boundaryKey,
  onRetry,
  modes,
  floaters,
  layers,
  children,
}: PaneProps) {
  const { root, body } = paneRecipe({ scroll, flush });
  const rootRef = useRef<HTMLElement>(null);
  const strip =
    modes != null || floaters != null || layers != null ? (
      <PaneStrip modes={modes} floaters={floaters} layers={layers} />
    ) : null;
  const heading = (
    <>
      {tabs ?? (
        <h2 data-slot="pane-title" data-heading={name ? "name" : undefined}>
          {title}
        </h2>
      )}
      {tabs == null && meta != null && (
        <TooltipHint content={typeof meta === "string" ? meta : undefined}>
          <span className="face-mono t-small min-w-0 truncate text-ink-mute">{meta}</span>
        </TooltipHint>
      )}
      {help != null && (
        <span className="shrink-0 self-center">
          <TooltipHint>{help}</TooltipHint>
        </span>
      )}
    </>
  );
  const paneBody = (
    <div data-slot="pane-body" className={body()}>
      <PaneErrorBoundary key={boundaryKey} what={title} onRetry={onRetry}>
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="flex flex-1 items-center justify-center t-small text-ink-2"
            >
              {title != null ? <>loading {title}…</> : "loading…"}
            </div>
          }
        >
          {children}
        </Suspense>
      </PaneErrorBoundary>
    </div>
  );
  return (
    <KeyScope id={id ?? "pane"} element={rootRef}>
      <section
        ref={rootRef}
        data-slot="pane"
        data-pane-id={id}
        data-surface={ground}
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        // A click on inert content focuses the pane, so its scope's keys bind.
        onPointerDownCapture={(event) => {
          const focusable = (event.target as HTMLElement).closest<HTMLElement>(
            "a,button,input,select,textarea,[contenteditable='true'],[tabindex]",
          );
          if (!focusable || focusable === event.currentTarget)
            event.currentTarget.focus({ preventScroll: true });
        }}
        className={root()}
      >
        {(title != null || tabs != null) && (
          <div data-slot="pane-header" data-title-align={titleAlign} className="shrink-0">
            <Rail
              lead={
                <>
                  {leadingActions}
                  {titleAlign === "start" ? heading : null}
                </>
              }
              center={titleAlign === "center" ? heading : undefined}
              trail={
                actions != null || strip != null ? (
                  <div data-slot="pane-actions" className="flex shrink-0 items-center">
                    {actions != null && (
                      <span data-slot="pane-action-group" className="flex items-center gap-1">
                        {actions}
                      </span>
                    )}
                    {strip}
                  </div>
                ) : undefined
              }
            />
          </div>
        )}
        {floaters == null ? (
          paneBody
        ) : (
          // The floaters' containing block: they sit over the body's corners and never scroll with it.
          <div data-slot="pane-field" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {paneBody}
            {floaters.map((spec) => (spec.open ? <Floater key={spec.key} spec={spec} /> : null))}
          </div>
        )}
      </section>
    </KeyScope>
  );
}

export { PaneSplit } from "./pane-resize";
