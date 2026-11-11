import { RegistryContext } from "@effect/atom-react";
import { AttentionDocument, picture as pictureAtom } from "./attention";
import { TooltipHint } from "./tooltip";
import {
  Children,
  Component,
  Fragment,
  Suspense,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from "react";

import { createPortal } from "react-dom";
import { ButtonGroup } from "./button-group";

import { Floater, type FloaterSpec } from "./floater";
import { PaneStrip, type PaneStripProps } from "./pane-strip";
import { KeyScope } from "../../keys";
import { Button } from "./button";
import { tv, type VariantProps } from "../../lib/tv";

import { Rail } from "./rail";
import { Scroll } from "./scroll";
import { cn } from "../../lib/utils";
import { PaneCrumb } from "./pane-crumb";
import { SubjectBox } from "./popover";
import "./lang.css";
import "./pane.css";
import { TeachPane, TeachRegion, teachText, useTeach } from "./use-teach";
import { Work, WorkContext, useWorkOwner, workAttributes } from "./work";

/** The renderer supplies geometry; the pane never knows a camera or a domain identity. */
export const PictureContext = createContext<{
  selected: boolean;
  box: () => DOMRect | null;
} | null>(null);
type ReadoutIdentity = { subject?: ReactNode; title?: ReactNode; onClear?: () => void };
export const PictureReadoutContext = createContext<
  ((identity: ReadoutIdentity) => () => void) | null
>(null);

const PaneFaultContext = createContext<((error: unknown) => void) | undefined>(undefined);
/** The application supplies its diagnostics sink once; kit has no host dependency. */
export function PaneFaultProvider({
  onFault,
  children,
}: {
  onFault: (error: unknown) => void;
  children: ReactNode;
}) {
  return <PaneFaultContext value={onFault}>{children}</PaneFaultContext>;
}
const PaneOverlayContext = createContext<HTMLElement | null | undefined>(undefined);
/** Nested furniture joins the pane field so floaters yield in one DOM order. */
export function PaneOverlay({
  label,
  place = "tl",
  children,
}: {
  label: string;
  place?: FloaterSpec["place"];
  children: ReactNode;
}) {
  const field = useContext(PaneOverlayContext);
  const overlay = (
    <Floater
      spec={{ key: label, kind: "legend", label, place, open: true, render: () => children }}
    />
  );
  return field === undefined ? overlay : field ? createPortal(overlay, field) : null;
}
const hasContent = (node: ReactNode): boolean =>
  Children.toArray(node).some((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? hasContent(child.props.children)
      : child !== "",
  );

// A pane is a header, a scrolling body and an error boundary; it is also a key scope, so a child's
// `useScopeKeys` binds while focus is inside it. Empty chrome draws no header.
export const paneRecipe = tv({
  slots: {
    // Pane overflow belongs to its body; an ancestor scrollbar would steal a sibling's floor.
    root: "relative flex size-full min-h-0 min-w-0 flex-col overflow-clip",
    // A column, so a call site docks a region under a scroller without a second scroller.
    body: "relative flex min-h-0 min-w-0 flex-1 flex-col",
    // The padded field inside the scroller, so the scrollbar strip runs the body's full height.
    field: "",
  },
  variants: {
    scroll: {
      auto: {},
      clip: { body: "overflow-hidden" },
      visible: { body: "overflow-visible" },
    },
    flush: {
      false: { field: "p-(--gutter)" },
      true: { field: "p-0" },
    },
  },
  defaultVariants: { scroll: "auto", flush: false },
});

interface PaneProps extends VariantProps<typeof paneRecipe>, PaneStripProps {
  /** Corner furniture shares drag, shrink and yield with the pane floaters. */
  overlay?: ReactNode;
  id?: string;
  title?: ReactNode;
  /** The title is the thing shown (a thread, a schedule), drawn as the page heading. */
  name?: boolean;
  /** A short machine fact (a count, a mode word), truncated beside the title. Prose is `help`. */
  meta?: ReactNode;
  help?: ReactNode;
  actions?: ReactNode;
  /** `wrap` drops the actions under the title and flows them at their own width (a header of chips). */
  fit?: "line" | "wrap";
  leadingActions?: ReactNode;
  titleAlign?: "start" | "center";
  /** Pane-view tabs replace the title line; the title stays the accessible name. */
  tabs?: ReactNode;
  /** The pane's ground; the artifact plane draws its own hairline. Default: the page. */
  ground?: "artifact";
  /** Change it when the child changes target, so an old error cannot mask the new one. */
  boundaryKey?: Key;
  onRetry?: () => void;
  /** The body's reading is unsettled: the kernel's own Work, drawn in this render, not after an effect. */
  busy?: boolean;
  children: ReactNode;
}

type PicturePaneProps = PaneProps &
  ({ picture: true; legend: ReactNode } | { picture?: false; legend?: never });

export class PaneErrorBoundary extends Component<
  { children: ReactNode; what?: ReactNode; onRetry?: () => void },
  { failed: boolean; message: string }
> {
  static contextType = PaneFaultContext;
  declare context: React.ContextType<typeof PaneFaultContext>;
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  // The pane boundary owns its fault; an inner boundary that caught first owns its own.
  componentDidCatch(error: unknown) {
    this.context?.(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-2">
        <span className="t-small" data-tone="caution">
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

/** A suspended body must either resolve or fail into its enclosing pane boundary. */
export function PaneLoading({ what = "pane" }: { what?: ReactNode }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), 15_000);
    return () => clearTimeout(timer);
  }, []);
  if (expired)
    throw Error("The page module or data did not load after 15s. Retry to load it again.");
  return <Work label={typeof what === "string" ? `loading ${what}…` : "loading…"} />;
}

export function Pane({
  id,
  title,
  name = false,
  meta,
  help,
  actions,
  fit,
  leadingActions,
  titleAlign = "start",
  tabs,
  scroll,
  flush,
  ground,
  boundaryKey,
  onRetry,
  busy = false,
  modes,
  floaters,
  picture,
  legend,
  overlay,
  layers,
  children,
}: PicturePaneProps) {
  const teachId = useTeach({
    kind: "region",
    // Machine ids address panes; only the displayed title names them in Tutorial.
    label: teachText(title) || "Contents",
    purpose: teachText(help) || undefined,
  });
  const { root, body, field: fieldClass } = paneRecipe({ scroll, flush });
  const rootRef = useRef<HTMLElement>(null);
  const { register: registerWork, labels: registered } = useWorkOwner();
  const work = busy && !registered.includes("reading…") ? [...registered, "reading…"] : registered;
  const stage = useContext(PictureContext);
  const attentionDoc = useContext(AttentionDocument) ?? "";
  const registry = useContext(RegistryContext);
  const [identity, setIdentity] = useState<ReadoutIdentity>({});
  const register = useCallback((next: ReadoutIdentity) => {
    setIdentity(next);
    return () => setIdentity((was) => (was === next ? {} : was));
  }, []);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const pictureBox = useCallback(
    () => stageRef.current?.box() ?? rootRef.current?.getBoundingClientRect() ?? null,
    [],
  );
  // The channel also reaches sibling panes, whose popovers must clear this picture.
  useEffect(() => {
    if (!picture) return;
    registry.set(pictureAtom(attentionDoc), { box: pictureBox });
    return () => {
      if (registry.get(pictureAtom(attentionDoc)).box === pictureBox)
        registry.set(pictureAtom(attentionDoc), { box: null });
    };
  }, [picture, registry, attentionDoc, pictureBox]);
  const crumb = picture ? (
    <PaneCrumb
      segments={[
        ...(hasContent(title) ? [{ label: title }] : []),
        ...(hasContent(identity.subject)
          ? [{ label: identity.subject, onPress: identity.onClear }]
          : []),
        ...((stage?.selected ?? true) && hasContent(identity.title)
          ? [{ label: identity.title }]
          : []),
      ]}
    />
  ) : (
    title
  );
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const strip =
    (modes?.options.length ?? 0) > 0 ||
    (floaters?.length ?? 0) > 0 ||
    (layers?.options.length ?? 0) > 0 ? (
      <PaneStrip modes={modes} floaters={floaters} layers={layers} />
    ) : null;
  const heading = (
    <>
      {hasContent(tabs) ? (
        tabs
      ) : hasContent(title) ? (
        // Help is the title's own hint, never a floating "?" beside it; Tutorial (Alt+/) teaches
        // the same `purpose` for keyboard readers and for tabbed heads, which carry no title.
        <TooltipHint content={hasContent(help) ? help : ""}>
          <h2
            data-slot="pane-title"
            data-heading={name ? "name" : undefined}
            data-help={hasContent(help) || undefined}
          >
            {crumb}
          </h2>
        </TooltipHint>
      ) : null}
      {!hasContent(tabs) && hasContent(meta) && (
        <TooltipHint content={typeof meta === "string" ? meta : undefined}>
          <span className="face-mono t-small min-w-0 truncate text-ink-mute">{meta}</span>
        </TooltipHint>
      )}
    </>
  );
  const guarded = (
    <PaneErrorBoundary key={boundaryKey} what={title} onRetry={onRetry}>
      <Suspense fallback={<PaneLoading what={title} />}>{children}</Suspense>
    </PaneErrorBoundary>
  );
  const paneBody =
    (scroll ?? "auto") === "auto" ? (
      <Scroll data-slot="pane-body" className={body()} fieldClassName={fieldClass()}>
        {guarded}
      </Scroll>
    ) : (
      <div data-slot="pane-body" className={cn(body(), fieldClass())}>
        {guarded}
      </div>
    );
  return (
    <TeachPane value={undefined}>
      <TeachRegion value={teachId}>
        <WorkContext value={registerWork}>
          <PictureReadoutContext value={picture ? register : null}>
            <SubjectBox box={picture ? pictureBox : null}>
              <KeyScope id={id ?? "pane"} element={rootRef}>
                <section
                  ref={rootRef}
                  data-slot="pane"
                  data-teach-id={teachId}
                  data-picture={picture || undefined}
                  data-pane-id={id}
                  data-surface={ground}
                  {...workAttributes("pane", work)}
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
                  {[title, meta, actions, leadingActions, tabs, strip].some(hasContent) && (
                    <div
                      data-slot="pane-header"
                      data-title-align={titleAlign}
                      data-fit={fit}
                      className="shrink-0"
                    >
                      <Rail
                        fit={fit}
                        lead={
                          <>
                            {leadingActions}
                            {titleAlign === "start" ? heading : null}
                          </>
                        }
                        center={titleAlign === "center" ? heading : undefined}
                        trail={
                          hasContent(actions) || strip != null ? (
                            <div data-slot="pane-actions" className="flex min-w-0 items-center">
                              {hasContent(actions) && <ButtonGroup>{actions}</ButtonGroup>}
                              {strip}
                            </div>
                          ) : undefined
                        }
                      />
                    </div>
                  )}
                  <PaneOverlayContext value={field}>
                    <div
                      ref={setField}
                      data-slot="pane-field"
                      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
                    >
                      {paneBody}
                      {hasContent(overlay) ? (
                        <PaneOverlay label="pane overlay" place="tr">
                          {overlay}
                        </PaneOverlay>
                      ) : null}
                      {floaters?.map((spec) =>
                        spec.open ? <Floater key={spec.key} spec={spec} /> : null,
                      )}
                      {hasContent(legend) ? (
                        <PaneOverlay label="picture legend" place="bl">
                          <div data-slot="pane-legend">{legend}</div>
                        </PaneOverlay>
                      ) : null}
                      {work.length > 0 && (
                        <div data-slot="pane-work" role="status" className="t-small">
                          {work.join(" · ")}
                        </div>
                      )}
                    </div>
                  </PaneOverlayContext>
                </section>
              </KeyScope>
            </SubjectBox>
          </PictureReadoutContext>
        </WorkContext>
      </TeachRegion>
    </TeachPane>
  );
}

export { PaneSplit, type PaneRail, type PaneSide } from "./pane-resize";
