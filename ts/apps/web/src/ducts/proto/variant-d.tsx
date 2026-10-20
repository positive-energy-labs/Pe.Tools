/**
 * THROWAWAY (protoui round 1): variant D, "Pea-first". Pea's authored claims are the navigation
 * base: the left column reads the subject sentence, then each claim with the rulings (inferred
 * joins, snapshot issues) nested under the claim whose elements they touch; orphans go last. The
 * centre is the iso drawing following the active claim, a one-line schematic of its legs above.
 * Element facts open in a click-anchored popover; there is no facts pane.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { transitionPatches, type DuctFinding } from "@pe/agent-contracts";

import { Button } from "@pe/kit/lang/button";
import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";
import { tolerated } from "@pe/ducts-domain/survey";
import { groupTree, runsOf } from "@pe/ducts-domain/topology";
import { claimInk, encodingOf } from "../encoding";
import {
  claimParts,
  elementNamer,
  nameOf,
  verdictPatches,
  VERDICTS,
  type ClaimPart,
  type Verdict,
} from "../claims";
import { DuctDrawing } from "../drawing";
import { NodeFactsView, SegmentFactsView } from "../facts";
import { Schematic } from "../inset";
import { ISSUE_KINDS } from "../issues";
import { useIso } from "../iso";
import { labelOfNode, legsOf, type Claim } from "../legs";
import { ProvisionalNote, GRADE_TONE } from "../provisional";
import { indexOf, subjectScene, type DuctIndex } from "../scene";
import type { ProtoProps } from "./props";

type Ruling =
  | { kind: "finding"; id: string; ids: number[]; finding: DuctFinding | ProximityLike }
  | { kind: "issue"; id: string; ids: number[]; issue: ProtoIssue };
type ProtoIssue = NonNullable<ProtoProps["snapshot"]>["issues"][number];
type ProximityLike = ReturnType<typeof tolerated>["findings"][number];

const fmt = (n: number | null | undefined, digits = 2) => (n == null ? null : n.toFixed(digits));

export function VariantD(props: ProtoProps) {
  const { snapshot, priced } = props;
  const index = useMemo(() => (snapshot ? indexOf(snapshot, priced) : null), [snapshot, priced]);
  if (!index || props.empty)
    return (
      <div data-proto="D" className="flex size-full items-center justify-center">
        <EmptyState story="scope" exit={props.empty?.exit ?? "wait for the snapshot"}>
          {props.empty?.says ?? "reading ducts…"}
        </EmptyState>
      </div>
    );
  return <PeaFirst {...props} index={index} />;
}

function PeaFirst(props: ProtoProps & { index: DuctIndex }) {
  const { index, subject, page, priced, work } = props;
  const snapshot = index.snapshot;
  const labelOf = useMemo(() => labelOfNode(snapshot), [snapshot]);
  // Fixture verdicts stay in this page (the fixture's onVerdict is a no-op); real ones go to Work.
  const [localVerdicts, setLocalVerdicts] = useState<Record<string, Verdict>>({});
  const claims: Claim[] = useMemo(
    () =>
      props.claims.map((c) =>
        localVerdicts[c.id] ? { ...c, verdict: localVerdicts[c.id] } : c,
      ),
    [props.claims, localVerdicts],
  );
  const cut = useMemo(
    () =>
      subject ? legsOf(snapshot, subject.ids, labelOf, work.doc ?? subject.work ?? null) : null,
    [snapshot, subject, labelOf, work.doc],
  );
  const drawn = useMemo(
    () => (subject && cut ? subjectScene(index, subject.ids, cut, claims) : null),
    [index, subject, cut, claims],
  );
  const iso = useIso(index, page, drawn);
  const sub = iso.scene.subject ?? null;
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);

  const activeIndex = claims.findIndex((c) => c.id === page.selected);
  const active = activeIndex >= 0 ? claims[activeIndex]! : null;

  // A claim's reach: its ids plus every leg it touches (the drawing's selection rule).
  const reachOf = useMemo(() => {
    const out = new Map<string, Set<number>>();
    for (const claim of claims) {
      const ids = new Set(claim.at);
      for (const leg of cut?.legs ?? [])
        if (claim.at.some((id) => leg.ids.includes(id) || leg.from.id === id || leg.to.id === id))
          for (const id of [...leg.ids, leg.from.id, leg.to.id]) ids.add(id);
      out.set(claim.id, ids);
    }
    return out;
  }, [claims, cut]);

  // Rulings: every proximity finding the survey makes and every snapshot issue on an element.
  const rulings: Ruling[] = useMemo(() => {
    const findings = tolerated(snapshot, work.doc).findings;
    return [
      ...findings.map(
        (f): Ruling => ({ kind: "finding", id: f.id, ids: f.elementIds, finding: f }),
      ),
      ...snapshot.issues.map(
        (issue): Ruling => ({
          kind: "issue",
          id: issue.id,
          ids: issue.elementId == null ? [] : [issue.elementId],
          issue,
        }),
      ),
    ];
  }, [snapshot, work.doc]);
  const rulingsOf = useMemo(() => {
    const by = new Map<string, Ruling[]>();
    const orphans: Ruling[] = [];
    for (const r of rulings) {
      let placed = false;
      for (const claim of claims)
        if (r.ids.some((id) => reachOf.get(claim.id)!.has(id))) {
          (by.get(claim.id) ?? by.set(claim.id, []).get(claim.id)!).push(r);
          placed = true;
        }
      if (!placed) orphans.push(r);
    }
    return { by, orphans };
  }, [rulings, claims, reachOf]);

  const selection = useMemo(
    () => (active ? (reachOf.get(active.id) ?? new Set<number>()) : new Set<number>()),
    [active, reachOf],
  );

  // Up/down step the active claim (left/right belong to the variant switcher).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.matches("input, textarea, select") || el.isContentEditable)) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!claims.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = activeIndex < 0 ? (step > 0 ? 0 : claims.length - 1) : activeIndex + step;
      const claim = claims[(next + claims.length) % claims.length]!;
      props.onSelectClaim(claim);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!active) return;
    listRef.current
      ?.querySelector(`[data-d-claim="${CSS.escape(active.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const verdict = (claim: Claim, value: Verdict) => {
    if (props.fromFixture) return setLocalVerdicts((v) => ({ ...v, [claim.id]: value }));
    void work.write(verdictPatches(work.doc, claim, value) as never);
  };
  const confirm = (id: string, on: boolean) =>
    void work.write(
      transitionPatches(
        ["assumptions"],
        id,
        work.doc?.assumptions[id] ?? {},
        on
          ? { kind: "stage", rung: { value: { kind: "verdict", verdict: "connect" } } }
          : { kind: "unstage" },
      ) as never,
    );

  // Element popover, anchored at the click point.
  const pointer = useRef({ x: 0, y: 0 });
  const [pop, setPop] = useState<{ id: number; x: number; y: number } | null>(null);
  const popSegment = pop ? iso.scene.segments.find((f) => f.segment.id === pop.id) : undefined;
  const popNode = pop ? iso.scene.nodes.find((f) => f.node.id === pop.id) : undefined;

  // Header facts.
  const subjectGroup =
    page.group ||
    (subject?.ids
      .map(
        (id) =>
          snapshot.segments.find((s) => s.id === id)?.groupId ??
          snapshot.nodes.find((n) => n.id === id)?.groupId,
      )
      .find((g) => g) ??
      "");
  const group = snapshot.groups.find((g) => g.id === subjectGroup) ?? null;
  const systemName =
    group?.systemNames[0] ??
    subject?.ids
      .map(
        (id) =>
          snapshot.segments.find((s) => s.id === id)?.systemName ??
          snapshot.nodes.find((n) => n.id === id)?.systemName,
      )
      .find((n) => n) ??
    null;
  const solved = subjectGroup ? priced?.now.byGroup[subjectGroup] : undefined;
  const equipment = snapshot.nodes.find(
    (n) => n.kind === "equipment" && (subject?.ids.includes(n.id) ?? group?.rootIds.includes(n.id)),
  );
  const stated = equipment?.facts.find(
    (f) => f.key === snapshot.slots.fanStatic || /static/i.test(f.key),
  );
  const criticalRun = useMemo(() => {
    if (!subjectGroup || solved?.critical == null) return null;
    return runsOf(groupTree(snapshot, subjectGroup)).find((r) => r.terminal === solved.critical);
  }, [snapshot, subjectGroup, solved]);
  const subjectFt = cut?.legs.reduce((sum, leg) => sum + leg.lengthFt, 0) ?? null;

  // Active claim's legs for the schematic.
  const activeLegs = active && cut ? cut.legs.filter((leg) => reachOf.get(active.id)!.has(leg.from.id) && reachOf.get(active.id)!.has(leg.to.id)) : [];
  const [stripW, setStripW] = useState(800);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const o = new ResizeObserver(([e]) => setStripW(Math.max(200, e!.contentRect.width)));
    o.observe(el);
    return () => o.disconnect();
  }, []);

  const verdictWord = (claim: Claim) => VERDICTS.find((v) => v.value === claim.verdict)?.word;
  const placesWord = sub
    ? `${sub.cut.legs.length} legs over ${sub.cut.nodes.length} places, ${sub.levels.map((l) => l.name).join(" / ")}`
    : "no subject";

  return (
    <div data-proto="D" className="flex size-full min-h-0 flex-col">
      <header
        className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1"
        data-d-header=""
      >
        <span data-d-system="">
          {systemName ?? (
            <span className="text-ink-2" title="the snapshot names no system for the subject">
              no system named
            </span>
          )}
        </span>
        <FactChip
          dashed={!solved}
          title="Pe's required fan static over the subject's group (largest path total); Revit holds none until written"
        >
          fan static{" "}
          <span className="face-mono">
            {solved ? `${fmt(solved.fan, 3)} in-wg` : "not priced"}
          </span>
        </FactChip>
        {solved ? <ProvisionalNote provisional={solved.provisional} of="the fan static" /> : null}
        <FactChip dashed={!stated} title="the equipment's stated external static (fanStatic slot)">
          stated{" "}
          <span className="face-mono">
            {stated?.value != null ? `${stated.value} ${stated.unit}` : "missing"}
          </span>
        </FactChip>
        <FactChip
          dashed={!criticalRun}
          title="Pe's critical run, root to the critical terminal; without pricing the subject's own run stands in"
        >
          {criticalRun ? (
            <>
              critical run{" "}
              <span className="face-mono">{criticalRun.developedFt.toFixed(1)} ft</span>
            </>
          ) : (
            <>critical run not priced</>
          )}
        </FactChip>
        {criticalRun ? null : (
          <FactChip dashed title="the subject's own developed length stands in until Pe prices the critical run">
            subject run{" "}
            <span className="face-mono">{subjectFt == null ? "—" : `${subjectFt.toFixed(1)} ft`}</span>{" "}
            (stand-in)
          </FactChip>
        )}
        {props.fromFixture ? (
          <FactChip dashed title="no host snapshot; scene.fixture.ts stands in">
            fixture
          </FactChip>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 w-[380px] shrink-0 flex-col overflow-auto border-r border-line"
          aria-label="claim stream"
        >
          <p className="px-2 py-2" data-d-subject="">
            {subject ? (
              <>
                Pea chose to show {placesWord}
                {claims.length ? `, and makes ${claims.length} claims about it.` : "."}
              </>
            ) : (
              <span className="text-ink-2">Pea has not chosen a subject.</span>
            )}
          </p>
          {claims.length ? null : (
            <p className="px-2 py-1 text-ink-2" data-d-claims="none">
              Pea has not proposed.
            </p>
          )}
          <ol ref={listRef} className="flex flex-col" aria-label="claims">
            {claims.map((claim, i) => {
              const on = claim.id === active?.id;
              const nested = rulingsOf.by.get(claim.id) ?? [];
              const names = sub ? [...new Set(claim.at.map((id) => nameOf(sub, id)))] : [];
              return (
                <li
                  key={claim.id}
                  data-d-claim={claim.id}
                  data-selected={on ? "" : undefined}
                  className="flex flex-col gap-1 border-b border-line px-2 py-2"
                  style={{
                    borderLeft: `3px solid ${claimInk(claim)}`,
                    background: on ? "var(--color-select-fill, rgba(80,140,255,.12))" : undefined,
                  }}
                  onClick={() => props.onSelectClaim(claim)}
                >
                  <div className="flex items-start gap-2">
                    <span className="face-mono t-small text-ink-2">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <Prose
                        parts={claimParts(claim.text, nameOfId)}
                        onHover={props.onHover}
                        onPick={(id) => {
                          setPop({ id, x: pointer.current.x, y: pointer.current.y });
                        }}
                        pointer={pointer}
                      />
                    </span>
                  </div>
                  <div className="t-small text-ink-2">
                    {claim.state}
                    {names.length ? ` · at ${names.join(", ")}` : ""}
                    {claim.verdict
                      ? ` · ${verdictWord(claim)} (${claim.verdictBy ?? (props.fromFixture ? "this page" : "person")})`
                      : ""}
                  </div>
                  <div
                    className="flex items-center gap-1"
                    role="group"
                    aria-label={`verdict on claim ${i + 1}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {VERDICTS.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        kind="framed"
                        label={option.word}
                        reason={option.says}
                        pressed={claim.verdict === option.value}
                        data-verdict={option.value}
                        onClick={() => verdict(claim, option.value)}
                      >
                        {option.word}
                      </Button>
                    ))}
                  </div>
                  {nested.length ? (
                    <ul className="ml-4 flex flex-col gap-1" aria-label="rulings on this claim">
                      {nested.map((r) => (
                        <RulingRow
                          key={r.id}
                          ruling={r}
                          nameOfId={nameOfId}
                          staged={stagedVerdict(work.doc, r.id)}
                          onConfirm={props.fromFixture ? null : confirm}
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <section className="px-2 py-2" aria-label="unclaimed rulings" data-d-unclaimed="">
            <p className="t-upper text-ink-2">unclaimed · {rulingsOf.orphans.length}</p>
            {rulingsOf.orphans.length ? (
              <ul className="flex flex-col gap-1">
                {rulingsOf.orphans.map((r) => (
                  <RulingRow
                    key={r.id}
                    ruling={r}
                    nameOfId={nameOfId}
                    staged={stagedVerdict(work.doc, r.id)}
                    onConfirm={props.fromFixture ? null : confirm}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-ink-2">every ruling sits under a claim</p>
            )}
          </section>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={stripRef} className="shrink-0 border-b border-line" data-d-strip="">
            {active && sub && activeLegs.length ? (
              <>
              <p className="px-2 pt-1 t-small" data-d-crumb="">
                claim {activeIndex + 1}: {activeLegs.map((leg) => leg.name).join(" › ")}
              </p>
              <svg width={stripW} height={64} aria-label="the subject one-line, the active claim's legs lit">
                <Schematic
                  cut={sub.cut}
                  levels={sub.levels}
                  levelAt={sub.levelAt}
                  selected={selection}
                  onSelect={(id) => setPop({ id, x: pointer.current.x, y: pointer.current.y })}
                  width={stripW}
                  height={64}
                />
              </svg>
              </>
            ) : (
              <p className="px-2 py-1 text-ink-2">
                {active
                  ? `claim ${activeIndex + 1} is at ${active.at.map((id) => nameOfId(id) ?? `element ${id}`).join(" › ")} (on no leg of the subject)`
                  : "no claim active: pick one on the left, or ↑/↓"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1 px-1 py-1">{iso.band}</div>
          <div
            className="flex min-h-0 flex-1 flex-col"
            onPointerDownCapture={(e) => {
              pointer.current = { x: e.clientX, y: e.clientY };
            }}
          >
            <DuctDrawing
              label={iso.label}
              project={iso.project}
              scene={iso.scene}
              encoding={encodingOf(page.encoding)}
              fitKey={iso.fitKey}
              selected={selection}
              hovered={props.hovered}
              issue={page.issue}
              claim={active?.id ?? ""}
              onHover={props.onHover}
              onSelect={(id) =>
                setPop(id == null ? null : { id, x: pointer.current.x, y: pointer.current.y })
              }
              onSelectClaim={props.onSelectClaim}
              onSelectIssue={(issue) =>
                issue.elementId != null &&
                setPop({ id: issue.elementId, x: pointer.current.x, y: pointer.current.y })
              }
              onDrag={iso.onDrag}
              underlay={iso.underlay}
            />
          </div>
        </main>
      </div>
      <Popover open={pop != null} onOpenChange={(open) => (open ? null : setPop(null))}>
        {pop ? (
          <PopoverContent
            anchor={{
              getBoundingClientRect: () => DOMRect.fromRect({ x: pop.x, y: pop.y, width: 0, height: 0 }),
            }}
            data-d-popover={pop.id}
          >
            <p className="pb-1">{nameOfId(pop.id) ?? `element ${pop.id}`}</p>
            {popSegment ? (
              <SegmentFactsView {...popSegment} />
            ) : popNode ? (
              <NodeFactsView {...popNode} />
            ) : (
              <p className="text-ink-2">element {pop.id} is not drawn in this scene</p>
            )}
          </PopoverContent>
        ) : null}
      </Popover>
    </div>
  );
}

const stagedVerdict = (doc: ProtoProps["work"]["doc"], id: string) => {
  const value = doc?.assumptions[id]?.staged?.value;
  return value?.kind === "verdict" ? value.verdict : null;
};

function Prose({
  parts,
  onHover,
  onPick,
  pointer,
}: {
  parts: readonly ClaimPart[];
  onHover: (id: number | null) => void;
  onPick: (id: number) => void;
  pointer: React.MutableRefObject<{ x: number; y: number }>;
}) {
  return parts.map((part, i) =>
    typeof part === "string" ? (
      <span key={i}>{part}</span>
    ) : (
      <button
        key={i}
        type="button"
        title={`${part.name} · element ${part.id}: click for its facts`}
        className="cursor-pointer underline decoration-dotted underline-offset-2"
        onMouseEnter={() => onHover(part.id)}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          pointer.current = { x: e.clientX, y: e.clientY };
          onPick(part.id);
        }}
      >
        {part.dot ? "•" : part.name}
      </button>
    ),
  );
}

function RulingRow({
  ruling,
  nameOfId,
  staged,
  onConfirm,
}: {
  ruling: Ruling;
  nameOfId: (id: number) => string | null;
  staged: string | null;
  onConfirm: ((id: string, on: boolean) => void) | null;
}) {
  const names = ruling.ids.map((id) => nameOfId(id) ?? `element ${id}`).join(" ↔ ");
  if (ruling.kind === "issue") {
    const info = ISSUE_KINDS[ruling.issue.kind];
    return (
      <li className="t-small" data-d-ruling={ruling.id}>
        <span data-tone={info.color.tone}>{info.label}</span> {names} ·{" "}
        <span className="text-ink-2">{ruling.issue.note}</span>
      </li>
    );
  }
  const f = ruling.finding;
  const confirmed = staged === "connect";
  return (
    <li className="t-small" data-d-ruling={ruling.id}>
      <span data-tone="caution">{f.kind}</span>{" "}
      {f.grade ? (
        <span data-tone={confirmed ? undefined : GRADE_TONE[f.grade]}>
          {confirmed ? `${f.grade}, confirmed` : f.grade}
        </span>
      ) : null}{" "}
      {names} · <span className="text-ink-2">{f.note}</span>{" "}
      {f.grade && onConfirm ? (
        <Button
          type="button"
          kind="framed"
          label={confirmed ? "take the confirmation back" : "confirm this join"}
          pressed={confirmed}
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(f.id, !confirmed);
          }}
        >
          {confirmed ? "confirmed" : "confirm"}
        </Button>
      ) : f.grade ? (
        <span className="text-ink-2">(fixture: confirm not wired)</span>
      ) : null}
    </li>
  );
}
