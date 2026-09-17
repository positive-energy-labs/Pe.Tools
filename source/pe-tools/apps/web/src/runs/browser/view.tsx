import { sumKnown } from "../world";
import { token } from "#/lib/token";
import { FactChip as Chip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface, SurfaceCell } from "#/components/lang/surface";
import { fb } from "../feedback/staging";
import { NoteInput } from "../feedback/verbs";
import { Tray, TrayCollapsed } from "../feedback/tray";
import { Press } from "#/components/lang/press";
import { fmtSqft, materiallyChanged, stagedPairedBy } from "./unknown";
import { ZoneCard } from "./zone-card";
import { PlanDock } from "./plan-dock";
import { LedgerDock } from "./ledger-dock";
import { useRunBrowserModel } from "./model";
import { RunBrowserHeader } from "./header";
import { PressContent } from "#/components/anatomy/press-content";

export default function RunBrowser() {
  const model = useRunBrowserModel();
  const {
    runs,
    pool,
    error,
    curId,
    underlay,
    changedOnly,
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
    stagedItems,
    prevId,
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
    sheetRef,
    panelFullW,
    panelHalfW,
    panelH,
    lens,
  } = model;

  if (error) {
    return (
      <div className="p-8">
        <OutcomeLine kind="error" label="run pool unavailable" says={error} />
      </div>
    );
  }

  if (!runs) {
    return <div className="p-8 text-ink-2">loading run pool…</div>;
  }

  if (runs.length === 0 || !curId) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 p-8">
        <EmptyState story="scope" exit="publish a Partition capture to fill the pool">
          No runs captured yet
        </EmptyState>
        <p className="t-small t-upper text-ink-2">
          Publish a completed capture with{" "}
          <code>python eval/rhvac/partition-run.py CAPTURE --label LABEL --zone-name ZONE</code>,
          then reload.
        </p>
        {pool && (
          <p
            className="t-small face-mono break-all text-ink-2"
            title="The run pool this page is reading — PE_TAKEOFF_RUNS_DIR if set, else <repo>/.artifacts/takeoff-runs."
          >
            pool {pool}
          </p>
        )}
      </div>
    );
  }

  const setMainRefs = (el: HTMLElement | null) => {
    sheetRef.current = el as HTMLDivElement | null;
    mainScrollRef.current = el;
  };

  // an A side by name; a keyed miss stays an honest orphan (SHIMS.md #2 close).
  const sheetBody = (
    <main ref={setMainRefs} onScroll={onSheetScroll} className="size-full min-h-0 overflow-y-auto">
      {reportCur === null ? (
        <div className="p-8">loading run…</div>
      ) : review ? (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-baseline gap-3">
            <h2 className="">review — {stagedItems.length} staged</h2>
            <span className="">each item at its pinned A/B pair · the lens is untouched</span>
            <Press
              type="button"
              tone="neutral"
              size="caption"
              onClick={() => setReview(false)}
              title="Back to the normal sheet."
              style={{ marginLeft: "auto" }}
            >
              ✕ exit review
            </Press>
          </div>
          {stagedItems.length === 0 && (
            <p className="">Nothing staged anymore — stage zone cards from the normal sheet.</p>
          )}
          {stagedItems.map((item) => {
            const onLens = item.runB === curId && item.runA === prevId;
            return (
              <div key={item.key} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <Press
                    type="button"
                    tone="quiet"
                    onClick={() => swingLens(item)}
                    title={
                      onLens
                        ? "This item's pinned pair IS the current lens."
                        : "Pinned pair ≠ current lens — click to swing the lens to this pair (the stage is untouched)."
                    }
                  >
                    <PressContent geometry="baseline">
                      <span>
                        pinned A {item.runA ?? "(none)"} → B {item.runB}
                      </span>
                      {!onLens && (
                        <span
                          style={{ color: token("caution") }}
                          title="Pinned pair differs from the page lens."
                        >
                          ≠ lens
                        </span>
                      )}
                    </PressContent>
                  </Press>
                  <Press
                    type="button"
                    tone="quiet"
                    size="caption"
                    onClick={() => fb.unstage(item.key)}
                    title="Remove this item from the staged set."
                    style={{ marginLeft: "auto" }}
                  >
                    ✕ unstage
                  </Press>
                </div>
                <ZoneCard
                  name={item.zone}
                  a={item.a}
                  b={item.b}
                  pairedBy={stagedPairedBy(item)}
                  runA={item.runA}
                  runB={item.runB}
                  panelFullW={panelFullW}
                  panelHalfW={panelHalfW}
                  panelH={panelH}
                  underlay={underlay}
                  highlighted={highlight === item.zone}
                  onToggleHighlight={toggleHighlight}
                  onSwing={swingLens}
                />
                <NoteInput item={item} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          {levels.map(({ level, zonePairs }) => {
            const visible = zonePairs.filter((pair) => {
              if (!comparing || !changedOnly) return true;
              return materiallyChanged(pair.a, pair.b);
            });
            const hidden = zonePairs.length - visible.length;
            const solved = zonePairs.filter((pair) => pair.b?.triage.verdict === "solve").length;
            const sf = sumKnown(
              zonePairs.filter((pair) => pair.b).map((pair) => pair.b!.AcceptedSqft),
            );
            return (
              <section
                key={level}
                ref={(el) => {
                  if (el) sectionRefs.current.set(level, el);
                  else sectionRefs.current.delete(level);
                }}
              >
                <div
                  className="sticky top-0 z-sticky -mx-4 mb-2 flex items-baseline gap-3 px-4 py-1"
                  style={{ borderColor: token("line-2") }}
                >
                  <h2 className="">{level}</h2>
                  <span className="">
                    {solved}/{zonePairs.length} solved · {fmtSqft(sf)}
                  </span>
                  {hidden > 0 && (
                    <Chip
                      tone="meta"
                      title="Zones with no material A/B change, hidden by the 'changed only' filter."
                    >
                      {hidden} unchanged hidden
                    </Chip>
                  )}
                </div>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                >
                  {visible.map((pair) => (
                    <div
                      key={pair.id}
                      className="min-w-0"
                      ref={(el) => {
                        if (el) cardRefs.current.set(pair.name, el);
                        else cardRefs.current.delete(pair.name);
                      }}
                    >
                      <ZoneCard
                        name={pair.name}
                        a={comparing ? pair.a : null}
                        b={pair.b}
                        pairedBy={pair.pairedBy}
                        runA={comparing ? prevId : null}
                        runB={curId}
                        panelFullW={panelFullW}
                        panelHalfW={panelHalfW}
                        panelH={panelH}
                        underlay={underlay}
                        highlighted={highlight === pair.name}
                        onToggleHighlight={toggleHighlight}
                        onSwing={swingLens}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );

  const sheetAndLedger = (
    <div className="flex size-full min-h-0 flex-col">
      <PaneSplit
        axis="horizontal"
        grow
        resize={{
          target: "end",
          defaultSize: 340,
          minSize: 260,
          minOtherSize: 360,
          persist: "pe-runs-tray-w",
          collapse: {
            collapsed: !trayOpen,
            onCollapsedChange: (c) => setTrayOpen(!c),
            collapsedSize: 30,
            collapseBelow: 140,
          },
        }}
        start={sheetBody}
        end={
          trayOpen ? (
            <Tray
              pool={pool}
              lens={lens}
              onSwing={swingLens}
              review={review}
              onToggleReview={() => setReview((r) => !r)}
            />
          ) : (
            <TrayCollapsed count={stagedItems.length} onExpand={() => setTrayOpen(true)} />
          )
        }
      />
      <LedgerDock
        runs={runs}
        pool={pool}
        curId={curId}
        prevId={prevId}
        open={ledgerOpen}
        onToggle={() => setLedgerOpen((o) => !o)}
        onPickCur={pickCur}
        onPickBaseline={pickBaseline}
      />
    </div>
  );

  return (
    <Surface head={<RunBrowserHeader model={model} />} columns="minmax(0, 1fr)">
      <SurfaceCell>
        <PaneSplit
          axis="vertical"
          resize={{
            target: "start",
            defaultSize: 360,
            minSize: 180,
            minOtherSize: 240,
            persist: "pe-runs-combo-plan-h",
            collapse: {
              collapsed: !planOpen,
              onCollapsedChange: (c) => setPlanOpen(!c),
              collapsedSize: 33,
              collapseBelow: 100,
            },
          }}
          start={
            <Pane
              kind="visual"
              title="plan"
              meta={comparing ? "A | B — panes share one viewport" : "the level, spatially true"}
              actions={
                <Press
                  type="button"
                  tone="neutral"
                  size="label"
                  onClick={() => setPlanOpen((o) => !o)}
                  title={
                    planOpen
                      ? "Collapse the plan dock (drag the divider to resize it)."
                      : "Expand the plan dock."
                  }
                >
                  {planOpen ? "▴ hide plan" : "▾ show plan"}
                </Press>
              }
            >
              {planOpen && (
                <PlanDock
                  curId={curId}
                  prevId={prevId}
                  underlay={underlay}
                  focus={focus}
                  levels={levels.map((l) => l.level)}
                  level={planLevel}
                  onPickLevel={pickLevel}
                  highlight={highlight}
                  onToggleZone={toggleZoneByName}
                />
              )}
            </Pane>
          }
          end={sheetAndLedger}
        />
      </SurfaceCell>
    </Surface>
  );
}
