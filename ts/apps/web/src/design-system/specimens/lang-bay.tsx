/**
 * The patch bay's primitives (host MAP, promotion 2026-10-12): `Connectors` between anchored rows
 * in both layouts, the query box's command mode after `→`, and the one session renderer in its
 * two densities with the arming strip the stop verb opens.
 */
import { useState } from "react";
import { Square } from "lucide-react";

import { ArmingStrip } from "#/components/lang/arming-strip";
import { Button } from "@pe/kit/lang/button";
import { Connectors, type Connection } from "#/components/lang/connector";
import { PidChip } from "#/components/lang/process";
import { Row } from "@pe/kit/lang/row";
import {
  heldRowParts,
  SessionCard,
  SessionRow,
  type SessionFacts,
} from "#/components/lang/session";
import type { QueryCommand, QueryVocabulary } from "@pe/kit/table/model";
import { QueryBox } from "@pe/kit/table/query";
import { useTableState } from "@pe/kit/table/view";
import { BACKGROUND_BOOTING, CHECKOUT_HOT, OBSERVED_ICON } from "#/open/seeds";

import { SpecimenFrame } from "./recipe-grid";

const JACKS = Array.from({ length: 14 }, (_, i) => `Model ${String.fromCharCode(65 + i)}.rvt`);
const SOCKETS = ["Revit 2025", "Revit 2024", "Pea's Revit 2025"];

const LINKS: Connection[] = [
  {
    key: "lit",
    from: "jack:1",
    to: "socket:0",
    tone: "commit",
    strong: true,
    band: 0.6,
    label: <span data-tone="commit">Hospital-MEP.rvt</span>,
    title: "a cable to a document a thread targets",
  },
  {
    key: "pea",
    from: "jack:4",
    to: "socket:2",
    tone: "pea",
    dashed: true,
    title: "Pea's copy",
  },
  {
    key: "upgrade",
    from: "jack:8",
    to: "socket:1",
    tone: "caution",
    label: <span data-tone="caution">23→25</span>,
    title: "an upgrade adapter",
  },
  { key: "plain", from: ["jack:12", "jacks-foot"], to: "socket:0", title: "a patched document" },
];

function Bay({ layout }: { layout: "row" | "stack" }) {
  const [bay, setBay] = useState<HTMLDivElement | null>(null);
  const jacks = (
    <div className="h-40 overflow-auto" data-key="jacks">
      {JACKS.map((jack, i) => (
        <Row key={jack} data-key={`jack:${i}`} label={jack} meta={2023 + (i % 3)} />
      ))}
    </div>
  );
  const sockets = (
    <div className="flex flex-col gap-1">
      {SOCKETS.map((socket, i) => (
        <Row key={socket} data-key={`socket:${i}`} label={socket} active={i === 0} />
      ))}
    </div>
  );
  return (
    <div
      ref={setBay}
      className={
        layout === "row"
          ? "relative grid w-[36rem] grid-cols-[1fr_6rem_12rem]"
          : "relative flex w-[20rem] flex-col gap-2 pr-6"
      }
    >
      {jacks}
      {layout === "row" ? <span /> : null}
      {sockets}
      <Connectors container={bay} links={LINKS} layout={layout} />
    </div>
  );
}

const VOCABULARY: QueryVocabulary = {
  fields: [
    { label: "document", kind: "text", sort: "document" },
    { label: "saved", kind: "number", sort: "saved" },
  ],
  rules: [],
  count: () => JACKS.length,
  values: (label) =>
    label === "saved" ? [2023, 2024, 2025].map((year) => ({ value: String(year), count: 4 })) : [],
};

function CommandBox() {
  const [state, setState] = useTableState();
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [detach, setDetach] = useState(false);
  const [ran, setRan] = useState<string | null>(null);
  const command: QueryCommand = {
    armed,
    onArmed: (next) => {
      setArmed(next);
      if (!next) {
        setTarget(null);
        setDetach(false);
      }
    },
    chips: [
      ...(target
        ? [
            {
              key: "target",
              label: target,
              title: "the Revit the rows open in",
              onRemove: () => setTarget(null),
            },
          ]
        : []),
      ...(detach
        ? [
            {
              key: "detach",
              label: "detach",
              title: "detached from central",
              onRemove: () => setDetach(false),
            },
          ]
        : []),
    ],
    tokens: (typed) =>
      [
        ...(target
          ? []
          : SOCKETS.map((socket) => ({
              key: socket,
              label: socket,
              hint: "a Revit",
              take: () => setTarget(socket),
            }))),
        ...(target
          ? []
          : [
              {
                key: "new",
                label: "new 2026",
                hint: "start one",
                take: () => setTarget("new 2026"),
              },
            ]),
        ...(detach
          ? []
          : [{ key: "detach", label: "detach", hint: "an option", take: () => setDetach(true) }]),
      ].filter((token) => token.label.toLowerCase().startsWith(typed)),
    onCommit: () =>
      setRan(`open ${state.query || "every row"} → ${target ?? "?"}${detach ? " · detached" : ""}`),
    says: "Enter opens the rows the query keeps in the named Revit",
    placeholder: "Revit 2025 · new 2026 · detach",
  };
  return (
    <div className="flex w-[36rem] flex-col gap-2">
      <div className="flex items-center px-2 hairline-b">
        <QueryBox
          vocabulary={VOCABULARY}
          state={state}
          onStateChange={setState}
          draft={draft}
          onDraft={setDraft}
          onInput={() => {}}
          placeholder="filter, then → a Revit"
          command={command}
        />
      </div>
      <span className="text-ink-2">
        {ran ?? "type a filter, then → or ->, then a Revit; Enter runs"}
      </span>
    </div>
  );
}

const facts = (over: Partial<SessionFacts>): SessionFacts => ({
  year: 2025,
  name: "pe-app-25-main",
  pid: 2501,
  phase: "ready",
  phaseTone: undefined,
  custody: "controlled",
  dialog: false,
  ...over,
});

const fixtureVerbs = (
  <>
    <Button label="hr" kind="framed" refusal="fixture: no Work">
      hr
    </Button>
    <Button label="stop" kind="framed" refusal="fixture: no Work">
      stop
    </Button>
  </>
);

export function LangBaySpecimens() {
  return (
    <>
      <SpecimenFrame name="Connectors · row and stack" importPath="#/components/lang/connector">
        <div className="flex flex-wrap items-start gap-6">
          <Bay layout="row" />
          <Bay layout="stack" />
        </div>
      </SpecimenFrame>
      <SpecimenFrame name="QueryBox · command after →" importPath="@pe/kit/table/query">
        <CommandBox />
      </SpecimenFrame>
      <SpecimenFrame name="SessionRow · SessionCard" importPath="#/components/lang/session">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex w-[22rem] flex-col">
            <SessionRow
              session={CHECKOUT_HOT}
              facts={facts({})}
              anchor="pe-app-25-main"
              verbs={fixtureVerbs}
            />
            <SessionRow
              session={OBSERVED_ICON}
              facts={facts({ year: 2024, name: null, pid: 2402, custody: "observed" })}
              anchor="pid:2402"
              verbs={fixtureVerbs}
            />
            <SessionRow
              session={BACKGROUND_BOOTING}
              facts={facts({ year: 2026, name: "pea-26", pid: null, phase: "booting" })}
              anchor="pea-26"
            />
          </div>
          <div className="flex w-[26rem] flex-col gap-2">
            <SessionCard
              session={CHECKOUT_HOT}
              facts={facts({ dialog: true })}
              anchor="card:pe-app-25-main"
              verbs={fixtureVerbs}
              strip={
                <ArmingStrip
                  verb="stop, keep work"
                  target="Revit 2025 pe-app-25-main"
                  facts={<PidChip pid={2501} />}
                  icon={Square}
                  says="Unsaved: project-a Tower.rvt. Stop keeps work: unsaved documents are saved first, a cloud model syncs first, and stop refuses if it cannot."
                  state={{ phase: "arming" }}
                  refusal="fixture: no Work"
                  onCommit={() => {}}
                  onCancel={() => {}}
                  alternatives={
                    <Button label="stop, discard edits" kind="framed" refusal="fixture: no Work">
                      stop, discard edits
                    </Button>
                  }
                />
              }
            />
            <SessionCard
              session={OBSERVED_ICON}
              facts={facts({ year: 2024, name: null, pid: 2402, custody: "observed" })}
              anchor="card:pid:2402"
              verbs={fixtureVerbs}
              documentParts={(document) => heldRowParts(document)}
              documentDetail={(document) => (
                <ArmingStrip
                  verb="close, keep work"
                  target={document.title ?? "document"}
                  icon={Square}
                  says="Closing saves unsaved work first."
                  state={{ phase: "arming" }}
                  refusal="fixture: no host"
                  onCommit={() => {}}
                  onCancel={() => {}}
                />
              )}
            >
              <Row label="patch a document here" refusal="fixture: pick a row in the table" />
            </SessionCard>
          </div>
        </div>
      </SpecimenFrame>
    </>
  );
}
