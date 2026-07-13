import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Settings } from "lucide-react";

import { SidePane } from "#/components/ui/side-pane";
import { Button } from "#/components/ui/button";
import { ThemeToggle } from "#/components/ThemeToggle";

/**
 * /poc/sidepane — exercises the SidePane primitive: a left thread-list pane and a right
 * "plugin" pane flanking a center reading column. The mono status line reports live
 * width/open values (proves onWidthChange/onOpenChange); the top buttons drive open state
 * programmatically (proves controlled mode). Mock data only, no workbench imports.
 */
export const Route = createFileRoute("/poc/sidepane")({
  component: SidePanePoc,
});

const THREADS = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  title: ["Ductwork clash sweep", "Level 3 core walls", "Curtain wall mullions", "Slab edge audit"][
    i % 4
  ],
  when: `${(i + 1) * 3}m ago`,
}));

const PARAMS = [
  ["Width", "600 mm"],
  ["Height", "2100 mm"],
  ["Fire Rating", "60 min"],
  ["Material", "Oak Veneer"],
  ["Cost", "$420"],
];

function SidePanePoc() {
  // Controlled open state for both panes — the header buttons toggle these.
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  // Live width readouts prove the onWidthChange callbacks fire during drag.
  const [leftW, setLeftW] = useState(300);
  const [rightW, setRightW] = useState(340);
  const [selected, setSelected] = useState(0);

  return (
    <main className="flex h-screen flex-col bg-[var(--paper)] p-6 text-foreground">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-[family-name:var(--font-display)] text-lg font-semibold">
          SidePane POC
        </h1>
        <Button size="sm" variant="outline" onClick={() => setLeftOpen((v) => !v)}>
          {leftOpen ? "Collapse" : "Expand"} left
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRightOpen((v) => !v)}>
          {rightOpen ? "Collapse" : "Expand"} right
        </Button>
        <ThemeToggle className="ml-auto" />
      </div>

      {/* Fixed-height frame the two panes flank. */}
      <div className="flex h-[80vh] min-h-0 overflow-hidden rounded-sm border border-[var(--line)]">
        <SidePane
          side="left"
          storageKey="poc.sidepane.left"
          open={leftOpen}
          onOpenChange={setLeftOpen}
          onWidthChange={setLeftW}
          defaultWidth={300}
          header={<span className="text-sm font-semibold">Threads</span>}
          // Left pane demonstrates the product default: chevron-only rail when collapsed
          // (no `rail` slot passed).
        >
          <ul className="p-1.5">
            {THREADS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t.id)}
                  data-active={t.id === selected}
                  className="w-full rounded-sm px-2.5 py-2 text-left hover:bg-[var(--paper-2)] data-[active=true]:bg-[var(--paper-2)]"
                >
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-[var(--slate)]">{t.when}</div>
                </button>
              </li>
            ))}
          </ul>
        </SidePane>

        {/* Center reading column. */}
        <section className="min-w-0 flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-prose space-y-4">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
              {THREADS[selected]?.title}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--slate)]">
              This center lane is the content the panes flank. Drag either pane's inner edge to
              resize it; collapse a pane and it stays a live rail rather than vanishing. The panes
              own their own width and persist it to localStorage under their storageKey.
            </p>
            <p className="text-sm leading-relaxed text-[var(--slate)]">
              Both panes here run in controlled mode — the buttons above set their open state, and
              the status line below reflects the callbacks the primitive emits. Nothing imports the
              workbench; this is mock data proving the primitive in isolation.
            </p>
            <pre className="mt-6 rounded-sm border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2 font-mono text-xs">
              left  {leftOpen ? "open " : "rail "} w={leftW}px{"\n"}right {rightOpen ? "open "
                : "rail "} w={rightW}px
            </pre>
          </div>
        </section>

        <SidePane
          side="right"
          storageKey="poc.sidepane.right"
          open={rightOpen}
          onOpenChange={setRightOpen}
          onWidthChange={setRightW}
          defaultWidth={340}
          header={<span className="text-sm font-semibold">Plugin · Family Type</span>}
          rail={
            <>
              <RailIcon label="Parameters" icon={Settings} />
              <RailIcon label="Apply" icon={Check} />
            </>
          }
        >
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {PARAMS.map(([name, value]) => (
                    <tr key={name} className="border-b border-[var(--line)]">
                      <td className="px-3 py-2 text-[var(--slate)]">{name}</td>
                      <td className="px-3 py-2 text-right font-mono">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--line)] px-3 py-2">
              <span className="text-xs text-[var(--slate)]">5 staged</span>
              <Button size="sm">
                <Check /> Apply
              </Button>
            </div>
          </div>
        </SidePane>
      </div>
    </main>
  );
}

function RailIcon({
  label,
  icon: Icon,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label}>
      <Icon />
    </Button>
  );
}
