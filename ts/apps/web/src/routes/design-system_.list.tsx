/** /design-system/list — every list kind on the one Row and the one collection (ix-list step c). */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { FactChip } from "@pe/kit/lang/chip";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ThemeToggle } from "@pe/kit/lang/theme-toggle";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import {
  FieldOptionsPanel,
  FreeTextPanel,
  LadderPanel,
  LEGEND,
  PalettePanel,
  Panel,
  PickListPanel,
  SidebarPanel,
  SlashPanel,
  TablePanel,
  ZonesPanel,
  CoreListPanel,
  readCoreListState,
} from "#/design-system/list-specimen";
import { CATEGORY_OPTIONS } from "#/design-system/specimens-data";
import type { FieldOptionState } from "#/lib/schema-to-field-render/shared";
import { FieldOptions } from "#/lib/schema-to-field-render/field-metadata";

export const Route = createFileRoute("/design-system_/list")({
  validateSearch: (search: Record<string, unknown>): { list?: string } => ({
    list: typeof search.list === "string" ? search.list : undefined,
  }),
  component: ListRoute,
});

/** A baked HostOnly domain and a LiveDocument one Revit changed after the read. Specimen data. */
const FIELD_OPTION_STATES: FieldOptionState[] = [
  {
    sourceKey: "category-names",
    runtime: "HostOnly",
    mode: "suggestion",
    allowsCustomValue: true,
    items: CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    isLoading: false,
    source: "examples",
    changed: false,
    dependencies: [],
  },
  {
    sourceKey: "schedule-field-names",
    runtime: "LiveDocument",
    mode: "suggestion",
    allowsCustomValue: true,
    items: [
      { value: "Flow", label: "Flow" },
      { value: "Size", label: "Size" },
    ],
    isLoading: false,
    source: "remote",
    changed: true,
    dependencies: [{ key: "CategoryName", scope: "sibling", value: "Ducts" }],
  },
];

/** A supply system's call tree: system, run, leg, element. Specimen data. */
interface SpecNode {
  key: string;
  name: string;
  loss?: string;
  children?: SpecNode[];
}
const SYSTEM_TREE: SpecNode[] = [
  {
    key: "sa19",
    name: "SA 19 · supply air, level 2 east wing",
    loss: "1.84",
    children: [
      {
        key: "sa19/r1",
        name: "run 1 · AHU-2 to VAV-2-14 (critical, longest developed length)",
        loss: "1.84",
        children: [
          { key: "sa19/r1/a", name: "leg A · 24×16 main", loss: "0.62" },
          {
            key: "sa19/r1/b",
            name: "leg B · 18×12 branch",
            loss: "0.71",
            children: [
              { key: "sa19/r1/b/e1", name: "elbow 90° radius 1.5", loss: "0.09" },
              { key: "sa19/r1/b/e2", name: "tee branch, converging flow", loss: "0.21" },
            ],
          },
          { key: "sa19/r1/c", name: "leg C · 10ø flex to diffuser", loss: "0.51" },
        ],
      },
      {
        key: "sa19/r2",
        name: "run 2 · AHU-2 to VAV-2-09",
        loss: "1.41",
        children: [{ key: "sa19/r2/a", name: "leg A · 24×16 main", loss: "0.62" }],
      },
    ],
  },
  { key: "ra04", name: "RA 04 · return air", loss: "0.77", children: [] },
];

function TreePanel({ say }: { say: (text: string) => void }) {
  const list = useList({
    items: SYSTEM_TREE,
    keyOf: (n) => n.key,
    search: (n) => ({ text: [n.name] }),
    tree: { childrenOf: (n) => n.children ?? [] },
    initialState: { open: ["sa19", "sa19/r1", "sa19/r1/b"] },
    onPick: (n) => say(`pick “${n.name}”`),
  });
  return (
    <ListView
      list={list}
      maxHeight="16rem"
      aria-label="system call tree"
      empty={{ message: "No systems in this document", exit: "Read a model" }}
      row={(n) => ({ label: n.name, meta: n.loss })}
    />
  );
}

function ListRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [said, say] = useState<string | null>(null);
  return (
    <div className="min-h-screen">
      <header className="sticky z-sticky">
        <div className="flex items-center justify-between py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link to="/design-system">← design system</Link>
            <span>list</span>
            <span>one row, one collection, every list kind</span>
            <FactChip
              dashed
              title="Chat seeds, demo pods, project-a zones, families demo parameters — the product lists compose these same pieces."
            >
              fixture
            </FactChip>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-col gap-8 pt-6 pb-16">
        <CoreListPanel
          state={readCoreListState(search.list)}
          onState={(state) => {
            void navigate({
              search: { list: JSON.stringify(state) },
              replace: true,
              resetScroll: false,
            });
          }}
        />
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
          <Panel title="sidebar" kind="List · actions">
            <SidebarPanel say={say} />
          </Panel>
          <Panel title="palette" kind="List · fuzzy · groups">
            <PalettePanel say={say} />
          </Panel>
          <Panel title="head picker" kind="List · levels">
            <LadderPanel say={say} />
          </Panel>
          <Panel title="combobox" kind="ListPopup trigger · async · create">
            <FieldOptionsPanel say={say} />
          </Panel>
          <Panel title="field options" kind="FieldOptions · baked, live, changed">
            <div className="flex flex-col gap-2">
              {FIELD_OPTION_STATES.map((options) => (
                <FieldOptions key={options.sourceKey} options={options} />
              ))}
            </div>
          </Panel>
          <Panel title="slash menu" kind="ListPopup caret · input-owned">
            <SlashPanel say={say} />
          </Panel>
          <Panel title="pick list" kind="List · substring · groups">
            <PickListPanel say={say} />
          </Panel>
          <Panel title="zones" kind="List · sticky heads · lead · chip">
            <ZonesPanel say={say} />
          </Panel>
          <Panel title="free text" kind="ListInput · suggestions">
            <FreeTextPanel say={say} />
          </Panel>
          <Panel title="tree" kind="ListView · depth · guides · cut hint">
            <TreePanel say={say} />
          </Panel>
          <Panel title="table" kind="Row as tr · cell list · multi">
            <TablePanel say={say} />
          </Panel>
        </div>

        {said ? (
          <OutcomeLine kind="advisory" label={said} says="the specimen writes nothing" />
        ) : null}

        <section aria-label="keys" className="flex flex-col gap-1">
          <b className="t-small t-upper">the keys, everywhere</b>
          <dl className="grid max-w-[80ch] grid-cols-[14rem_1fr] gap-x-3 gap-y-0.5 t-small">
            {LEGEND.map(([key, says]) => (
              <div key={key} className="contents">
                <dt className="face-mono">{key}</dt>
                <dd className="text-ink-2">{says}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
