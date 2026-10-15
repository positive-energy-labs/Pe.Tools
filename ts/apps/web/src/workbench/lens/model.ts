import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useCacheView } from "../world";
import { useWorkbench } from "../provider";
import { useCurrentThreadView } from "../thread-view";
import { selectBreakdown, selectMessages } from "@pe/agent-contracts/chat-state";
import { intentAt, scrollTopForIntent } from "../model";
import type { Geom } from "./scale";
import { FOCAL, railLayout, type RailLayout } from "./scale";
import { toMoments } from "./moments";
import type { ChatState } from "@pe/agent-contracts/chat-state";

/** Within this many px of the bottom, the view counts as at the bottom and follows. */
const FOLLOW_SLACK = 24;

export function useLensModel({ state }: { state: ChatState }) {
  const messages = useMemo(() => selectMessages(state), [state]);

  const moments = toMoments(messages);

  const breakdown = useMemo(() => selectBreakdown(state), [state]);

  const userTurns = moments.reduce(
    (count, moment) => (moment.role === "user" ? count + 1 : count),
    0,
  );

  const cache = useCacheView(breakdown, userTurns);

  const { loading } = useWorkbench();

  const frameRef = useRef<HTMLDivElement>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);

  const chatRef = useRef<HTMLDivElement>(null);

  const stripRef = useRef<HTMLDivElement>(null);

  const wickRef = useRef<HTMLDivElement>(null);

  const capTopRef = useRef<HTMLDivElement>(null);

  const capBotRef = useRef<HTMLDivElement>(null);

  const csFocalRef = useRef<HTMLDivElement>(null);

  const caretRef = useRef<HTMLDivElement>(null);

  const momentRefs = useRef(new Map<string, HTMLElement>());

  const bandRefs = useRef(new Map<string, HTMLElement>());

  const geomRef = useRef<Geom[]>([]);

  const view = useCurrentThreadView();

  // The position intent lives in the store (`lensIntent`); follow is derived from it. The store
  // is per thread (WorkbenchProvider is keyed on it), so nothing here resets on a thread switch.
  const intent = useCallback(() => view.registry.get(view.atoms.lensIntent), [view]);
  const setIntent = view.actions.setLensIntent;

  // The opening position is placed ONCE — the URL's turn, else the tail. After that the view
  // follows the newest event only while the user sits at the bottom; a scroll up stops it, a scroll
  // back down (or jump-to-tail) resumes it. This overrules F-J1's no-follow (drive, 2026-10-01).
  const landedRef = useRef(false);
  const followRef = useRef(false);
  const [awayFromTail, setAwayFromTail] = useState(false);
  const awayRef = useRef(false);

  const [, bumpMeasure] = useReducer((tick: number) => tick + 1, 0);

  const bumpPending = useRef(false);

  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollerRef.current;
    if (!frame || !scroller) return;
    const apply = () => frame.style.setProperty("--vp", `${scroller.clientHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Register each rendered moment's DOM node so the scroll controller can
  // measure it (bands, fisheye). Keyed by message id — aligned with `moments`. Each
  // register/unregister schedules a re-measure so geometry tracks the async mount.
  const registerMoment = useCallback((id: string, el: HTMLElement | null) => {
    if (el) momentRefs.current.set(id, el);
    else momentRefs.current.delete(id);
    // Coalesce a burst of registers (one per moment) into a single re-render.
    if (!bumpPending.current) {
      bumpPending.current = true;
      queueMicrotask(() => {
        bumpPending.current = false;
        bumpMeasure();
      });
    }
  }, []);

  // Click a band to center its turn. No drag-to-scrub: the dial is a row of targets, and the
  // scrub gesture only ever fought the click.
  const onBandClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const scroller = scrollerRef.current;
      const bandKey = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-annotation="dial-band"]',
      )?.dataset.key;
      if (!scroller || !bandKey) return;
      const g = geomRef.current.find((geom) => geom.key === bandKey);
      if (!g) return;
      landedRef.current = true;
      setIntent({ kind: "turn", turn: g.turn });
      scroller.scrollTo({ top: g.top - FOCAL * scroller.clientHeight, behavior: "smooth" });
    },
    [setIntent],
  );

  // Jump-to-tail: the one thing that puts the view at the bottom, and only when pressed. The press
  // lives beside the lens and above the composer, which dispatch `pe:focus-tail`.
  useEffect(() => {
    const onTail = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      landedRef.current = true;
      scroller.scrollTo({ top: scroller.scrollHeight - scroller.clientHeight, behavior: "smooth" });
    };
    window.addEventListener("pe:focus-tail", onTail);
    return () => window.removeEventListener("pe:focus-tail", onTail);
  }, []);

  // The single scroll controller: reticle + bands + the stored position.
  // Mutates refs only (no per-frame React render). Re-measures on resize and on row changes.
  // A layout effect: the snap lands after the grown content is laid out and before it paints.
  // The scroller has no CSS smooth scrolling, so every `scrollTop =` here is instant.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const frame = frameRef.current;
    const strip = stripRef.current;
    if (!scroller || !frame || !strip) return;

    const atBottom = () =>
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_SLACK;

    let geom: Geom[] = [];
    // Doc y → rail y (`railLayout`): the thread fits the rail like a scrollbar; nothing slides.
    let map: RailLayout = { bands: new Map(), at: () => 0 };

    const sync = () => {
      const s = scroller.scrollTop;
      const V = scroller.clientHeight;
      const away = !atBottom();
      if (away !== awayRef.current) {
        awayRef.current = away;
        setAwayFromTail(away);
      }
      const fy = FOCAL * V;

      // the reticle: the viewport's extent on the fixed map
      const wickTop = map.at(s);
      const wickH = map.at(s + V) - wickTop;
      if (wickRef.current) {
        wickRef.current.style.top = `${wickTop}px`;
        wickRef.current.style.height = `${wickH}px`;
      }
      if (capTopRef.current) capTopRef.current.style.top = `${wickTop}px`;
      if (capBotRef.current) capBotRef.current.style.top = `${wickTop + wickH}px`;
      if (csFocalRef.current) csFocalRef.current.style.top = `${map.at(s + fy)}px`;
      if (caretRef.current) caretRef.current.style.top = `${map.at(s + fy)}px`;

      // The intent is what a reload reopens: the tail while at the bottom, else the focal turn.
      // Not before the opening position has landed: a scroll before that is not the user's.
      if (landedRef.current) {
        const metrics = { scrollTop: s, scrollHeight: scroller.scrollHeight, clientHeight: V };
        const next = intentAt(geom, metrics, FOCAL, FOLLOW_SLACK);
        if (next) setIntent(next);
      }

      // which stub sits on the focal axis?
      const focalDoc = s + FOCAL * V;
      let fk: string | null = null;
      for (const g of geom) {
        if (g.top <= focalDoc && focalDoc < g.top + g.height) {
          fk = g.key;
          break;
        }
        if (g.top <= focalDoc) fk = g.key;
      }
      // No focal mark on the moment: the dial band is the one "where am I" (its own `.focal`).
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        band.classList.toggle("in-reticle", g.top + g.height > s && g.top < s + V);
        band.classList.toggle("focal", g.key === fk);
      }
    };

    const measure = () => {
      geom = moments.flatMap((moment) => {
        const el = momentRefs.current.get(moment.id);
        return el
          ? [
              {
                key: moment.id,
                turn: moment.turn,
                top: el.offsetTop,
                height: el.offsetHeight,
              },
            ]
          : [];
      });
      geomRef.current = geom;
      // The dial is a scrollbar's stand-in: a thread that fits the lane has nowhere to go.
      frame.toggleAttribute("data-scrolls", scroller.scrollHeight > scroller.clientHeight + 1);
      map = railLayout(geom, scroller.scrollHeight, scroller.clientHeight);
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        const box = map.bands.get(g.key)!;
        band.style.top = `${box.top}px`;
        band.style.height = `${box.height}px`;
      }
      const metrics = {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      };
      // The opening position, placed ONCE. A later re-measure (streaming text, an image, a tool
      // body) moves the scroller only to keep a following view at the bottom.
      const current = intent();
      if (!landedRef.current && geom.length > 0) {
        if (current.kind === "tail") {
          scroller.scrollTop = scrollTopForIntent(current, geom, metrics, FOCAL);
          landedRef.current = true;
        } else if (geom.some((g) => g.turn === current.turn && g.height > 0)) {
          scroller.scrollTop = scrollTopForIntent(current, geom, metrics, FOCAL);
          landedRef.current = true;
        } else if (!loading && !moments.some((moment) => moment.turn === current.turn)) {
          // The thread is here and has no such turn: open at the tail instead.
          scroller.scrollTop = scrollTopForIntent({ kind: "tail" }, geom, metrics, FOCAL);
          landedRef.current = true;
        }
        // A short thread never scrolls, so the landing decides follow, not a scroll event.
        followRef.current = landedRef.current && atBottom();
      } else if (landedRef.current && followRef.current) {
        scroller.scrollTop = scrollTopForIntent({ kind: "tail" }, geom, metrics, FOCAL);
      }
      sync();
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };

    measure();
    // The box AND the content: a message that grows after render (highlighting, an image, a tool
    // body) re-measures the dial's geometry. It does NOT move the scroller.
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (chatRef.current) ro.observe(chatRef.current);
    // A scroll re-draws the dial and decides follow: at the bottom (within a line) follows.
    const onScroll = () => {
      followRef.current = atBottom();
      schedule();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
    // `moments` is a fresh array each render; re-running re-measures geometry as the thread (and
    // streaming text heights) change. The register callback re-measures once the moment sections
    // mount.
  }, [moments, loading, intent, setIntent]);
  // An empty thread is a claim; while the body loads it is not known (the composer head says so).
  const showEmpty = !loading && moments.length === 0;
  return {
    messages,
    moments,
    showEmpty,
    breakdown,
    userTurns,
    cache,
    frameRef,
    scrollerRef,
    chatRef,
    stripRef,
    wickRef,
    capTopRef,
    capBotRef,
    csFocalRef,
    caretRef,
    bandRefs,
    registerMoment,
    onBandClick,
    awayFromTail,
  };
}
