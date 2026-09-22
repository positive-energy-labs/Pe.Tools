import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScopeKeys } from "#/route/keys";
import { type StagedItem, useFb } from "../feedback/staging";
import { type Lens } from "../feedback/tray";
import {
  boardSummary,
  comparableRuns,
  pairZones,
  partiality,
  type RunIndexEntry,
  type RunReport,
  type RunScores,
  type ZonePair,
  type ZoneRecord,
} from "../world";
import { useRunsSource } from "../source";
import type { FocusRequest } from "./zone-peek";
import type { Baseline } from "./baseline";
import { pairingCaveat, useElementWidth } from "./unknown";

export function useRunBrowserModel() {
  const source = useRunsSource();
  const [runs, setRuns] = useState<RunIndexEntry[] | null>(null);

  const [pool, setPool] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [curId, setCurId] = useState<string | null>(null);

  const [baseline, setBaseline] = useState<Baseline>("auto");

  const [underlay, setUnderlay] = useState(false);

  const [changedOnly, setChangedOnly] = useState(false);

  const [planOpen, setPlanOpen] = useState(true);

  const [ledgerOpen, setLedgerOpen] = useState(source.initialLedgerOpen);

  const [trayOpen, setTrayOpen] = useState(true);

  const [review, setReview] = useState(false);

  const [highlight, setHighlight] = useState<string | null>(null);

  const [planLevel, setPlanLevel] = useState<string | null>(null);

  const [focus, setFocus] = useState<FocusRequest | null>(null);

  const [reportCur, setReportCur] = useState<RunReport | null>(null);

  const [reportPrev, setReportPrev] = useState<RunReport | null>(null);

  const [linkNote, setLinkNote] = useState<string | null>(null);

  const { items: stagedItems } = useFb();

  const [scoresCur, setScoresCur] = useState<RunScores | null | undefined>(undefined);

  const [scoresPrev, setScoresPrev] = useState<RunScores | null | undefined>(undefined);

  const [modalZones, setModalZones] = useState<number | null>(null);

  useEffect(() => {
    if (!runs || runs.length === 0) return;
    let live = true;
    source.poolModalZones(runs.map((entry) => entry.id)).then(
      (modal) => live && setModalZones(modal),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [runs, source]);

  useEffect(() => {
    source
      .fetchRunIndex()
      .then((index) => {
        setRuns(index.runs);
        setPool(index.pool);
        setCurId((prev) => prev ?? index.runs[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, [source]);

  const linkApplied = useRef(false);

  const pendingZone = useRef<string | null>(null);

  useEffect(() => {
    if (!runs || linkApplied.current) return;
    linkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const set = params.get("set");
    if (set) {
      source
        .hydrateFromSet(set)
        .then(() => setTrayOpen(true))
        .catch((err: unknown) => setLinkNote(`set ${set} did not load: ${String(err)}`));
    }
    const b = params.get("b");
    const a = params.get("a");
    const has = (id: string | null) => id !== null && runs.some((r) => r.id === id);
    if (has(b)) setCurId(b);
    if (has(a) && a !== b) setBaseline(a);
    const zone = params.get("zone");
    if (zone) pendingZone.current = zone;
    if ((b && !has(b)) || (a && !has(a))) {
      setLinkNote(
        `deep link run${b && !has(b) ? ` B=${b}` : ""}${a && !has(a) ? ` A=${a}` : ""} is not in the pool`,
      );
    }
  }, [runs, source]);

  const prevId = useMemo(() => {
    if (!runs || !curId || baseline === null) return null;
    const idx = runs.findIndex((r) => r.id === curId);
    const current = runs[idx];
    if (!current) return null;
    const candidates =
      baseline === "auto" ? runs.slice(idx + 1) : runs.filter((r) => r.id === baseline);
    return (
      candidates.find((r) => r.id !== curId && comparableRuns(current.meta ?? {}, r.meta ?? {}))
        ?.id ?? null
    );
  }, [runs, curId, baseline]);

  useEffect(() => {
    if (!curId) return;
    let live = true;
    setReportCur(null);
    setScoresCur(undefined);
    source
      .loadRunReport(curId)
      .then((r) => live && setReportCur(r))
      .catch((err: unknown) => live && setError(String(err)));
    source
      .loadRunScores(curId)
      .then((s) => live && setScoresCur(s))
      .catch((err: unknown) => {
        console.error("runs: scores.json load failed", err);
        if (live) setScoresCur(null);
      });
    return () => {
      live = false;
    };
  }, [curId, source]);

  useEffect(() => {
    if (!prevId) {
      setReportPrev(null);
      setScoresPrev(undefined);
      return;
    }
    let live = true;
    setReportPrev(null);
    setScoresPrev(undefined);
    source
      .loadRunReport(prevId)
      .then((r) => live && setReportPrev(r))
      .catch(() => live && setReportPrev(null));
    source
      .loadRunScores(prevId)
      .then((s) => live && setScoresPrev(s))
      .catch(() => live && setScoresPrev(null));
    return () => {
      live = false;
    };
  }, [prevId, source]);

  const moveRun = useCallback(
    (delta: -1 | 1) => {
      if (!runs?.length) return;
      setCurId((current) => {
        const idx = Math.max(
          0,
          runs.findIndex((run) => run.id === current),
        );
        return runs[Math.max(0, Math.min(runs.length - 1, idx + delta))]?.id ?? current;
      });
    },
    [runs],
  );
  useScopeKeys([
    {
      hotkey: "Escape",
      callback: () => setHighlight(null),
      label: "clear highlight",
      says: "clear the highlighted zone",
      options: { enabled: highlight !== null },
    },
    ...(
      [
        [-1, "ArrowUp", "previous run"],
        [1, "ArrowDown", "next run"],
      ] as const
    ).map(([delta, hotkey, name]) => ({
      hotkey,
      callback: () => moveRun(delta),
      label: name,
      says: `select the ${name}`,
      options: { enabled: Boolean(runs?.length) },
    })),
  ]);

  const pickCur = useCallback((id: string) => {
    setCurId(id);
    setBaseline((b) => (b === id ? "auto" : b));
  }, []);

  const pickBaseline = useCallback((id: string) => setBaseline((b) => (b === id ? null : id)), []);

  const swingLens = useCallback((item: StagedItem) => {
    setCurId(item.runB);
    setBaseline(item.runA);
  }, []);

  const toggleHighlight = useCallback((zone: ZoneRecord) => {
    setHighlight((cur) => {
      if (cur === zone.Zone) return null;
      setPlanOpen(true);
      setPlanLevel(zone.Level);
      setFocus((f) => ({ zone, nonce: (f?.nonce ?? 0) + 1 }));
      return zone.Zone;
    });
  }, []);

  const toggleZoneByName = useCallback((zoneName: string) => {
    setHighlight((cur) => (cur === zoneName ? null : zoneName));
  }, []);

  // (SHIMS.md #2 close). Orphans under key pairing are honest orphans, never name-matched.
  const comparing =
    prevId !== null &&
    reportPrev !== null &&
    reportCur !== null &&
    comparableRuns(reportCur, reportPrev);

  const pairs = useMemo(
    () => (reportCur ? pairZones(reportCur, comparing ? reportPrev : null) : []),
    [reportCur, reportPrev, comparing],
  );

  const levels = useMemo(() => {
    const order: string[] = [];
    const byLevel = new Map<string, ZonePair[]>();
    for (const pair of pairs) {
      if (!byLevel.has(pair.level)) {
        byLevel.set(pair.level, []);
        order.push(pair.level);
      }
      byLevel.get(pair.level)!.push(pair);
    }
    return order.map((level) => ({ level, zonePairs: byLevel.get(level)! }));
  }, [pairs]);

  useEffect(() => {
    if (levels.length === 0) return;
    setPlanLevel((cur) => (cur && levels.some((l) => l.level === cur) ? cur : levels[0]!.level));
  }, [levels]);

  const mainScrollRef = useRef<HTMLElement | null>(null);

  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const cardRefs = useRef(new Map<string, HTMLElement>());

  const suppressUntil = useRef(0);

  const onSheetScroll = useCallback(() => {
    if (review) return;
    if (Date.now() < suppressUntil.current) return;
    const main = mainScrollRef.current;
    if (!main) return;
    const mainTop = main.getBoundingClientRect().top;
    let active: string | null = null;
    for (const [level, el] of sectionRefs.current) {
      if (el.getBoundingClientRect().top - mainTop <= 90) active = level;
    }
    if (active) setPlanLevel((cur) => (cur === active ? cur : active));
  }, [review]);

  const pickLevel = useCallback((level: string) => {
    setPlanLevel(level);
    const el = sectionRefs.current.get(level);
    if (el) {
      suppressUntil.current = Date.now() + 900;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  useEffect(() => {
    const name = pendingZone.current;
    if (!name || !reportCur) return;
    pendingZone.current = null;
    const zone = reportCur.Zones.find((z) => z.Zone === name);
    if (!zone) {
      setLinkNote(`deep link zone "${name}" is not in run ${curId ?? "?"}`);
      return;
    }
    toggleHighlight(zone);
    requestAnimationFrame(() => {
      const el = cardRefs.current.get(name);
      if (el) {
        suppressUntil.current = Date.now() + 900;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [reportCur, curId, toggleHighlight]);

  const board = reportCur ? boardSummary(reportCur) : null;

  const boardPrev = comparing && reportPrev ? boardSummary(reportPrev) : null;

  const prevMeta = runs?.find((r) => r.id === prevId)?.meta ?? null;

  const partCur = reportCur ? partiality(reportCur, modalZones) : null;

  const partPrev = comparing && reportPrev ? partiality(reportPrev, modalZones) : null;

  const abCaveat = partCur && partPrev ? pairingCaveat(partPrev, partCur) : null;

  const [sheetRef, sheetW] = useElementWidth();

  const cardInnerW = sheetW > 0 ? Math.max(280, Math.floor((sheetW - 32 - 12) / 2) - 18) : 560;

  const reviewInnerW = sheetW > 0 ? Math.max(280, sheetW - 32 - 18) : 1120;

  const panelFullW = review ? reviewInnerW : cardInnerW;

  const panelHalfW = Math.floor(((review ? reviewInnerW : cardInnerW) - 8) / 2);

  const panelH = review ? 440 : 220;

  const lens: Lens = { curId, prevId: comparing ? prevId : null };
  return {
    runs,
    pool,
    error,
    curId,
    baseline,
    setBaseline,
    underlay,
    setUnderlay,
    changedOnly,
    setChangedOnly,
    planOpen,
    setPlanOpen,
    ledgerOpen,
    setLedgerOpen,
    trayOpen,
    setTrayOpen,
    review,
    setReview,
    highlight,
    planLevel,
    focus,
    reportCur,
    linkNote:
      linkNote ??
      ((baseline !== null && baseline !== "auto" && !prevId) ||
      (reportPrev && reportCur && !comparableRuns(reportCur, reportPrev))
        ? "Baseline refused: document or captured zone scope differs."
        : comparing && !reportCur?.documentKey
          ? "Historical comparison: document identity is unavailable in these packages."
          : null),
    stagedItems,
    scoresCur,
    scoresPrev,
    prevId: comparing ? prevId : null,
    pickCur,
    pickBaseline,
    swingLens,
    toggleHighlight,
    toggleZoneByName,
    comparing,
    levels,
    mainScrollRef,
    sectionRefs,
    cardRefs,
    onSheetScroll,
    pickLevel,
    board,
    boardPrev,
    prevMeta,
    partCur,
    partPrev,
    abCaveat,
    sheetRef,
    panelFullW,
    panelHalfW,
    panelH,
    lens,
  };
}

export type RunBrowserModel = ReturnType<typeof useRunBrowserModel>;
