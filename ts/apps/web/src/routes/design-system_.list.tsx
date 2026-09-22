/** /design-system/list — every list kind on the one Row and the one collection (ix-list step c). */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { ThemeToggle } from "#/components/lang/theme-toggle";
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
} from "#/design-system/list-specimen";

export const Route = createFileRoute("/design-system_/list")({ component: ListRoute });

function ListRoute() {
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
