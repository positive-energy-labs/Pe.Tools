import { landings, type HomeCost, type ProductDeclaration } from "@pe/agent-contracts/product";
import { Table } from "@pe/kit/table/table";
import type { Column } from "@pe/kit/table/model";

const WORK = "Work";
const platformHomes = [
  {
    key: WORK,
    kind: "work",
    rung: 2,
    cost: {
      readsPerCommand: "One Work document",
      placesThatCanDisagree: "One per Work member",
      setupBeforeFirstUse: "None",
      writeBorrows: "Nothing in the model",
      sizeLimit: "No model record limit",
      seenInRevit: "Nothing until applied",
    },
  },
  {
    key: "Route address",
    kind: "url",
    rung: null,
    cost: {
      readsPerCommand: "None",
      placesThatCanDisagree: "One per URL",
      setupBeforeFirstUse: "None",
      writeBorrows: "Nothing in the model",
      sizeLimit: "URL length",
      seenInRevit: "Nothing",
    },
  },
  {
    key: "Route layout",
    kind: "browser storage",
    rung: null,
    cost: {
      readsPerCommand: "None",
      placesThatCanDisagree: "One per browser and route",
      setupBeforeFirstUse: "None",
      writeBorrows: "Nothing in the model",
      sizeLimit: "Browser storage quota",
      seenInRevit: "Nothing",
    },
  },
  {
    key: "Project home",
    kind: "content home",
    rung: 3,
    status: "Declared · unreachable",
    cost: {
      readsPerCommand: "Unavailable",
      placesThatCanDisagree: "One per project",
      setupBeforeFirstUse: "A project folder and a model pointer",
      writeBorrows: "Nothing in the model for file writes",
      sizeLimit: "File system limits",
      seenInRevit: "Nothing",
    },
  },
] satisfies readonly HomeDetails[];

type HomeDetails = {
  key: string;
  kind: string;
  rung: number | null;
  cost: HomeCost;
  status?: string;
};
type HomeRow = HomeDetails & {
  name: string;
  owner: string;
  cells: readonly string[];
  commands: readonly string[];
};

const costLabels: readonly [keyof HomeCost, string][] = [
  ["readsPerCommand", "Reads per command"],
  ["placesThatCanDisagree", "Places that can disagree"],
  ["setupBeforeFirstUse", "Setup before first use"],
  ["writeBorrows", "Write borrows"],
  ["sizeLimit", "Size limit"],
  ["seenInRevit", "Visible in Revit"],
];

const columns: readonly Column<HomeRow>[] = [
  {
    key: "home",
    label: "Home",
    cell: ({ name, key, owner, status }) => (
      <>
        <div>{name}</div>
        {key !== name && <div>{key}</div>}
        <div>{owner}</div>
        {status && <div>{status}</div>}
      </>
    ),
  },
  { key: "kind", label: "Kind", cell: (row) => row.kind },
  { key: "rung", label: "Rung", cell: (row) => row.rung ?? "Outside ladder" },
  {
    key: "cells",
    label: "Lands in this home",
    cell: ({ cells }) => cells.join(", ") || "None",
  },
  {
    key: "commands",
    label: "Writes to this home",
    cell: ({ commands }) => commands.join(", ") || "None",
  },
  {
    key: "cost",
    label: "Cost",
    cell: ({ cost }) =>
      costLabels.map(([key, label]) => (
        <div key={key}>
          {label} · {cost[key]}
        </div>
      )),
  },
];

export function TutorialHomes({ product }: { product: ProductDeclaration }) {
  const lands = landings(product);
  const cells = Object.keys(product.cells);
  const rows: HomeRow[] = [
    ...platformHomes.map((home) => ({
      ...home,
      name: home.key,
      owner: "Platform",
      cells: home.key === WORK ? cells.filter((cell) => !Object.hasOwn(lands, cell)) : [],
      commands: [],
    })),
    ...Object.entries(product.homes).map(([name, home]) => ({
      ...home,
      name,
      owner: product.id,
      cells: cells.filter((cell) => lands[cell] === name),
      commands: Object.keys(product.commands).filter((key) =>
        Object.hasOwn(product.commands[key].writes, name),
      ),
    })),
  ];
  return (
    <section className="px-8" aria-label="Homes">
      <Table
        label="Homes"
        caption="Homes"
        rows={rows}
        columns={columns}
        rowKey={(row) => JSON.stringify([row.owner, row.name])}
        maxHeight="24rem"
      />
    </section>
  );
}
