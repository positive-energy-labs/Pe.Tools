import { useList } from "@pe/kit/lang/collection";
import { ListView, PlainList } from "@pe/kit/lang/list-view";
/**
 * The list grammar's swatch frames: the one Row (its recipe and every state), and the containers
 * that draw it — List inline, ListPopup on a trigger, and the in-cell list. The full comparison of
 * every list kind on real data is /design-system/list.
 */
import { useState } from "react";

import { GoToPopup } from "@pe/kit/lang/go-to";
import {
  CellListSelect,
  List,
  ListChips,
  ListInput,
  ListPopup,
  ListSegmentInput,
  PopupFrame,
  CommandPalette,
} from "@pe/kit/lang/list-popup";
import { Popover } from "@base-ui/react/popover";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@pe/kit/lang/button";

import { RevitTarget, Row, RowGroupHead, rowRecipe } from "@pe/kit/lang/row";
import { Table } from "@pe/kit/table/table";

import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

const VAST_ROWS = Array.from({ length: 1000 }, (_, index) => ({
  key: String(index),
  name: `Row ${index + 1}`,
}));
const KINDS = ["String", "Integer", "Double", "ElementId"];
const common = {
  items: KINDS,
  keyOf: (k: string) => k,
  labelOf: (k: string) => k,
  empty: "no storage types",
  row: (k: string) => ({ label: k }),
};

export function LangListSpecimens() {
  const vast = useList({
    items: VAST_ROWS,
    keyOf: (item) => item.key,
    search: (item) => ({ text: [item.name] }),
    groups: { of: (item) => `Section ${Math.floor(Number(item.key) / 250) + 1}` },
  });
  const plain = useList({ ...common, search: (kind) => ({ text: [kind] }) });
  return (
    <>
      <SpecimenFrame name="ListView - 1000 rows - minimap" importPath="@pe/kit/lang/list-view">
        <ListView
          list={vast}
          aria-label="1000 rows"
          maxHeight="calc(var(--item-h) * 12)"
          row={(item) => ({
            label: item.name,
            damage: Number(item.key) % 137 === 0 ? "Needs repair" : undefined,
          })}
          empty={{ message: "No rows", exit: "Clear search" }}
        />
      </SpecimenFrame>
      <SpecimenFrame name="GoToPopup" importPath="@pe/kit/lang/go-to">
        <GoToPopup
          items={() => KINDS.map((name, id) => ({ key: name, name, id }))}
          onGo={() => {}}
        />
      </SpecimenFrame>
      <SpecimenFrame name="PlainList" importPath="@pe/kit/lang/list-view">
        <PlainList
          list={plain}
          aria-label="storage types"
          row={common.row}
          empty={{ message: "No storage types", exit: "Read a family" }}
        />
      </SpecimenFrame>
      <RecipeGrid
        name="Row"
        importPath="@pe/kit/lang/row"
        recipe={rowRecipe}
        render={(props) => (
          <div className="flex w-64 flex-col">
            <RowGroupHead label="states" count={6} />
            <Row label="rest" meta="meta" lines={props.lines === "2" ? 2 : 1} sub="second line" />
            <Row label="cursor" cursor />
            <Row
              label="A long row title stays readable in a narrow pane"
              sub="Secondary content wraps at the same edge and adds only the height it needs."
              lines={2}
              wrap
            />
            <Row label="selected" selected />
            <RevitTarget scope={{ document: null, source: "fixture" }}>
              <Row label="Revit target (fixture: actions refuse)" revitIds={[42]} />
            </RevitTarget>
            <Row label="active" active />
            <Row label="pending" pending />
            <Row label="failed" failed />
            <Row label="refused" refusal="read-only in Revit" />
            <Row
              label="verbs take the meta slot on hover"
              meta="3m"
              actions={<Button icon={MoreHorizontal} label="Row actions" />}
            />
          </div>
        )}
      />
      <SpecimenFrame name="List · ListPopup · CellListSelect" importPath="@pe/kit/lang/list-popup">
        <div className="grid w-full grid-cols-3 gap-4">
          <ListPopup
            {...common}
            anchor="trigger"
            face="field"
            select="multi"
            selected={["String", "Double"]}
            trigger={<ListChips labels={["String", "Double"]} none="any storage" />}
            aria-label="multi list"
          />
          <FreeText />
          <SegmentInput />
          <List {...common} aria-label="inline list" filter="substring" />
          <List
            {...common}
            aria-label="retained pending rows"
            status="pending"
            filter="substring"
          />
          <List
            {...common}
            aria-label="retained failed rows"
            status="failed"
            failure="Read failed; showing known storage types"
          />
          <ListPopup
            {...common}
            anchor="trigger"
            trigger={<span className="face-mono">String</span>}
            aria-label="popup list"
          />
          <Popover.Root>
            <Popover.Trigger render={<Button label="plan 1/3" />}>
              <span className="face-mono">plan 1/3</span>
            </Popover.Trigger>
            <PopupFrame side="top" align="end" label="plain popup">
              <div className="grid w-64 p-1.5 t-small text-ink-2">
                <span>✓ read families</span>
                <span className="text-ink">▸ propose Manufacturer</span>
                <span>○ apply</span>
              </div>
            </PopupFrame>
          </Popover.Root>
          <Table<{ key: string }>
            label="cell list"
            rows={[{ key: "Width" }]}
            rowKey={(r) => r.key}
            columns={[
              {
                key: "storage",
                label: "storage",
                cell: () => <CellListSelect {...common} value="String" aria-label="storage" />,
              },
            ]}
          />
        </div>
      </SpecimenFrame>
      <SpecimenFrame name="CommandPalette" importPath="@pe/kit/lang/list-popup">
        <PaletteSpecimen />
      </SpecimenFrame>
    </>
  );
}

function PaletteSpecimen() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("none");
  const items = [
    { key: "family", label: "Family audit", group: "Tools", reason: null },
    { key: "thread", label: "Pea coordination thread", group: "Threads", reason: null },
    {
      key: "closed",
      label: "Closed document Work",
      group: "Works",
      reason: "Its open-document lifetime ended",
    },
  ];
  return (
    <div className="flex items-center gap-3">
      <Button label="Open shared command palette" onClick={() => setOpen(true)}>
        Open palette
      </Button>
      <span className="text-ink-2">Chosen fixture: {picked}</span>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        aria-label="Shared destination palette specimen"
        items={items}
        keyOf={(item) => item.key}
        labelOf={(item) => item.label}
        groupOf={(item) => item.group}
        filter="fuzzy"
        searchAbove={0}
        searchPlaceholder="Search fixture destinations"
        empty="No fixture destinations"
        onPick={(item) => setPicked(item.label)}
        row={(item) => ({ label: item.label, refusal: item.reason })}
        footer={
          <p className="px-1 pb-1 text-ink-2">
            Fixture destinations only; this specimen does not navigate.
          </p>
        }
      />
    </div>
  );
}

/** The pick fixes or frees the input: "fixed" disables it and shows the fixed value. */
function SegmentInput() {
  const [pick, setPick] = useState("fixed");
  const [value, setValue] = useState("");
  return (
    <ListSegmentInput
      popup={{
        "aria-label": "segment",
        triggerLabel: pick,
        trigger: <span className="face-mono">{pick}</span>,
        items: ["fixed", "free"],
        keyOf: (k) => k,
        labelOf: (k) => k,
        selected: [pick],
        empty: "no picks",
        onPick: setPick,
        row: (k) => ({ label: k }),
      }}
      aria-label="segment input"
      disabled={pick === "fixed"}
      placeholder={pick === "fixed" ? "https://api.example.com" : "type a URL"}
      value={pick === "fixed" ? "" : value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function FreeText() {
  const [value, setValue] = useState("");
  return (
    <ListInput
      aria-label="free text"
      value={value}
      onChange={setValue}
      suggestions={KINDS.map((kind) => ({ value: kind }))}
      placeholder="type or pick"
    />
  );
}
