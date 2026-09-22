/**
 * The /design-system/list specimen: every list KIND the app draws, side by side on the one `Row`
 * and the one `useCollection`, over real fixtures (chat seeds, demo pods, three synthetic zones, the
 * families demo parameters). Nothing here is cut over; this page is the question for Kai.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { FactChip } from "#/components/lang/chip";
import { CellListSelect, List, ListInput, ListPopup } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";
import { Table } from "#/components/master-table/table";
import { CHAT_SEEDS, CHAT_SEED_STATE, CHAT_SEED_THREADS } from "#/chat/seeds";
import { DEMO_FAMILIES } from "#/families/seeds";
import { DEMO_PODS } from "#/route/seeds";
import { ZoneThumb } from "#/takeoff/zone-plan";
import { selectSkillCommands } from "#/workbench/chat-state";

/* ── fixtures ────────────────────────────────────────────────────────────────────────────── */

interface Thread {
  id: string;
  title: string;
}
export const THREADS: Thread[] = [
  ...CHAT_SEED_THREADS,
  ...Object.entries(CHAT_SEEDS).map(([id, seed]) => ({ id, title: seed.title })),
];

interface LadderItem {
  key: string;
  label: string;
  sub?: string;
  pending?: boolean;
  failed?: boolean;
  refusal?: string;
}
const INVENTORY = CHAT_SEEDS.send.readings.inventory.sessions;
const SESSIONS: LadderItem[] = [
  ...INVENTORY.map((s) => ({ key: s.sessionId, label: s.sessionId, sub: "connected" })),
  { key: "pe.app-25", label: "pe.app-25", sub: "reading…", pending: true },
  { key: "pe.app-24", label: "pe.app-24", sub: "read failed: bridge closed", failed: true },
];
export const LADDER = [
  { label: "session", items: () => SESSIONS },
  {
    label: "document",
    items: (path: readonly LadderItem[]) =>
      (INVENTORY.find((s) => s.sessionId === path[0]?.key)?.openDocuments ?? []).map((d) => ({
        key: d.openId,
        label: d.title,
        sub: d.isActive ? "active" : undefined,
      })),
  },
];

interface Option {
  key: string;
  label: string;
  sub?: string;
}
/** The families demo parameters and one built-in, as `settings.field-options` would answer. */
export const FIELD_OPTIONS: Option[] = [
  ...new Set(DEMO_FAMILIES.flatMap((f) => f.parameters.map((p) => p.definition.identity.name))),
]
  .map((name) => ({ key: `name:${name}`, label: name, sub: "family parameter" }))
  .concat([{ key: "builtin:-1001203", label: "Comments", sub: "built-in · instance" }]);

interface Member {
  key: string;
  label: string;
  pod: string;
  schema: string | null;
}
export const MEMBERS: Member[] = DEMO_PODS.flatMap((pod) =>
  pod.members.map((m) => ({
    key: `${pod.id}:${m.path}`,
    label: m.path,
    pod: pod.name,
    schema: m.schema,
  })),
);

interface Zone {
  key: string;
  label: string;
  lane: string;
  loops: [number, number][][];
  color: string | null;
}
const box = (x: number, y: number, w: number, h: number): [number, number][][] => [
  [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
];
export const ZONES: Zone[] = [
  {
    key: "zone-0",
    label: "Transparent Cyan 4",
    lane: "Mechanical Zoning Plan - Main Level",
    loops: box(10, 10, 40, 30),
    color: "0,210,210",
  },
  {
    key: "zone-1",
    label: "Transparent Magenta 2",
    lane: "Mechanical Zoning Plan - Main Level",
    loops: box(55, 10, 25, 30),
    color: "210,0,210",
  },
  {
    key: "zone-2",
    label: "Transparent Yellow 1",
    lane: "Mechanical Zoning Plan - Upper Level",
    loops: box(10, 45, 70, 20),
    color: null,
  },
];
const bounds = (loops: [number, number][][]) => {
  const points = loops.flat();
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

export const COMMANDS = selectSkillCommands(CHAT_SEED_STATE.inspect).map((c) => ({
  key: c.name,
  label: `/${c.name}`,
  sub: c.description,
}));

/* ── panels ──────────────────────────────────────────────────────────────────────────────── */

export function Panel({
  title,
  kind,
  children,
}: {
  title: string;
  kind: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col" aria-label={title}>
      <div className="hairline-b flex items-baseline justify-between gap-2 pb-1">
        <b className="t-small t-upper">{title}</b>
        <span className="t-small face-mono text-ink-2">{kind}</span>
      </div>
      <div className="min-h-0 pt-1">{children}</div>
    </section>
  );
}

export function SidebarPanel({ say }: { say: (text: string) => void }) {
  const [current, setCurrent] = useState(THREADS[0]!.id);
  return (
    <List
      aria-label="threads"
      region="thread list"
      items={THREADS}
      keyOf={(t) => t.id}
      labelOf={(t) => t.title}
      empty="no threads yet — send a prompt to start one"
      onPick={(t) => setCurrent(t.id)}
      row={(t) => ({
        label: t.title,
        active: t.id === current,
        actions: (
          <>
            <Press
              size="icon"
              tone="quiet"
              title="rename"
              onClick={() => say(`rename “${t.title}”`)}
            >
              <Pencil />
            </Press>
            <Press
              size="icon"
              tone="quiet"
              title="delete"
              onClick={() => say(`delete “${t.title}”`)}
            >
              <Trash2 />
            </Press>
          </>
        ),
      })}
    />
  );
}

export function PalettePanel({ say }: { say: (text: string) => void }) {
  return (
    <List
      aria-label="thread palette"
      region="thread palette"
      items={THREADS}
      keyOf={(t) => t.id}
      labelOf={(t) => t.title}
      groupOf={(t) => (CHAT_SEED_THREADS.some((r) => r.id === t.id) ? "Recent" : "All threads")}
      filter="fuzzy"
      searchPlaceholder="jump to a thread (fuzzy)…"
      empty="no threads yet"
      maxHeight="12rem"
      onPick={(t) => say(`open “${t.title}”`)}
      row={(t) => ({ label: t.title })}
    />
  );
}

export function LadderPanel({ say }: { say: (text: string) => void }) {
  return (
    <List
      aria-label="session and document"
      region="head picker"
      levels={LADDER}
      keyOf={(i) => i.key}
      labelOf={(i) => i.label}
      filter="substring"
      empty="no Revit session is running"
      onPick={(item, path) => say(`bound ${[...path, item].map((i) => i.label).join(" › ")}`)}
      footer={
        <Press tone="quiet" size="value" onClick={() => say("target cleared")}>
          Clear target
        </Press>
      }
      row={(i) => ({
        label: i.label,
        meta: i.sub,
        pending: i.pending,
        failed: i.failed,
        refusal: i.pending
          ? "still reading its documents"
          : i.failed
            ? "its documents could not be read"
            : null,
      })}
    />
  );
}

/** Async field options: pending, then the options; the current value is no longer in the model. */
export function FieldOptionsPanel({ say }: { say: (text: string) => void }) {
  const [status, setStatus] = useState<"pending" | "ready">("pending");
  const [value, setValue] = useState("name:PE_G___Legacy Tag");
  useEffect(() => {
    const timer = setTimeout(() => setStatus("ready"), 900);
    return () => clearTimeout(timer);
  }, []);
  const stale = !FIELD_OPTIONS.some((o) => o.key === value);
  const items = useMemo(
    () =>
      stale
        ? [
            {
              key: value,
              label: `${value.replace(/^name:/, "")} (unavailable)`,
              sub: "not in the model now",
            },
            ...FIELD_OPTIONS,
          ]
        : FIELD_OPTIONS,
    [stale, value],
  );
  return (
    <ListPopup
      anchor="trigger"
      aria-label="field options"
      region="field options"
      trigger={
        <span className="face-mono">{items.find((o) => o.key === value)?.label ?? value}</span>
      }
      items={items}
      keyOf={(o) => o.key}
      labelOf={(o) => o.label}
      filter="substring"
      status={status}
      select="single"
      selected={[value]}
      empty="the model has no parameters"
      onPick={(o) => setValue(o.key)}
      onCreate={(text) => say(`new parameter “${text}”`)}
      createLabel={(text) => `＋ new parameter “${text}”`}
      row={(o) => ({
        label: o.label,
        sub: o.sub,
        lines: 2,
        refusal: o.key === value && stale ? "not in the model now — pick a live one" : null,
      })}
    />
  );
}

/** The composer slash menu: the textarea owns the keys and the query; the list sits at the caret. */
export function SlashPanel({ say }: { say: (text: string) => void }) {
  const [text, setText] = useState("");
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  const slash = /(?:^|\s)\/(\w*)$/.exec(text);
  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={setArea}
        aria-label="composer"
        rows={2}
        className="hairline w-full resize-none bg-transparent p-1 t-small outline-none"
        placeholder="type / for a skill"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <ListPopup
        anchor="caret"
        caret={area}
        open={slash !== null}
        onOpenChange={(open) => (open ? undefined : setText((t) => t.replace(/\/\w*$/, "")))}
        owner={area}
        query={slash?.[1] ?? ""}
        aria-label="skills"
        region="composer"
        items={COMMANDS}
        keyOf={(c) => c.key}
        labelOf={(c) => c.key}
        filter="substring"
        empty="no skills in this session"
        onPick={(c) => {
          setText((t) => t.replace(/\/\w*$/, `${c.label} `));
          say(`inserted ${c.label}`);
        }}
        row={(c) => ({ label: <span className="face-mono">{c.label}</span>, meta: c.sub })}
      />
    </div>
  );
}

export function PickListPanel({ say }: { say: (text: string) => void }) {
  const [picked, setPicked] = useState(MEMBERS[0]!.key);
  return (
    <List
      aria-label="pod members"
      region="pods"
      items={MEMBERS}
      keyOf={(m) => m.key}
      labelOf={(m) => m.label}
      groupOf={(m) => m.pod}
      filter="substring"
      searchAbove={3}
      empty="this pod has no members"
      onPick={(m) => {
        setPicked(m.key);
        say(`open ${m.label}`);
      }}
      row={(m) => ({
        label: m.label,
        active: m.key === picked,
        meta: m.schema ? m.schema.split("/").pop()?.replace(".json", "") : "raw",
      })}
    />
  );
}

export function ZonesPanel({ say }: { say: (text: string) => void }) {
  return (
    <List
      aria-label="zones"
      region="zones"
      items={ZONES}
      keyOf={(z) => z.key}
      labelOf={(z) => z.label}
      groupOf={(z) => z.lane}
      maxHeight="14rem"
      empty="no zones declared on this level"
      onPick={(z) => say(`zone ${z.label}`)}
      row={(z) => ({
        lead: (
          <ZoneThumb
            className="size-4"
            zone={{
              loops: z.loops,
              bounds: bounds(z.loops),
              color: `rgb(${z.color ?? "128,128,128"})`,
            }}
          />
        ),
        label: z.label,
        meta: (
          <FactChip title="How many boundary loops the declared zone has.">
            {z.loops.length} loop{z.loops.length === 1 ? "" : "s"}
          </FactChip>
        ),
      })}
    />
  );
}

/** Free text with suggestions (the settings forms' datalist): the input keeps what was typed. */
export function FreeTextPanel({ say }: { say: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <ListInput
      mono
      aria-label="parameter name"
      placeholder="type a name, or pick one"
      value={text}
      onChange={(next) => {
        setText(next);
        say(`value “${next}”`);
      }}
      suggestions={FIELD_OPTIONS.map((o) => ({ value: o.label, label: o.sub }))}
    />
  );
}

const STORAGE = ["String", "Integer", "Double", "ElementId"].map((s) => ({ key: s, label: s }));

export function TablePanel({ say }: { say: (text: string) => void }) {
  const [storage, setStorage] = useState<Record<string, string>>(
    Object.fromEntries(FIELD_OPTIONS.map((o) => [o.key, "String"])),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="flex flex-col gap-1">
      <Table
        label="parameters"
        rows={FIELD_OPTIONS}
        rowKey={(o) => o.key}
        selection={{ selected, onChange: setSelected }}
        maxHeight="12rem"
        columns={[
          {
            key: "name",
            label: "parameter",
            cell: (o) => <span className="px-(--item-pad-x)">{o.label}</span>,
          },
          {
            key: "storage",
            label: "storage",
            width: "w-32",
            cell: (o) => (
              <CellListSelect
                aria-label={`${o.label} storage`}
                region="table"
                value={storage[o.key] ?? "String"}
                items={STORAGE}
                keyOf={(s) => s.key}
                labelOf={(s) => s.label}
                empty="no storage types"
                select="single"
                selected={[storage[o.key] ?? "String"]}
                onPick={(s) => {
                  setStorage({ ...storage, [o.key]: s.key });
                  say(`${o.label} → ${s.key}`);
                }}
                row={(s) => ({ label: <span className="face-mono">{s.label}</span> })}
              />
            ),
          },
        ]}
      />
      <span className="t-small face-mono text-ink-2">
        {selected.size} selected (shift-click a range)
      </span>
    </div>
  );
}

export const LEGEND: [string, string][] = [
  ["↑ / ↓ · Home / End", "move the cursor (not the selection)"],
  ["Enter", "pick · advance a ladder level · open a cell's list (and F2)"],
  ["type", "filter (substring or fuzzy), or the composer's query"],
  ["Space · Shift+↑/↓ · Shift+click", "multi: toggle · extend over the visible rows"],
  ["Esc", "clear the query · up a level · close, focus back where it came from"],
  ["Tab / Shift+Tab", "in a cell's list: close and move to the next / previous cell"],
];
