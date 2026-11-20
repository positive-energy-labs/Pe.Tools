import { entities, machineFiles, ownerBlobs } from "@pe/host-contracts/native-homes";
import { SETTING_TIERS, type SettingTier } from "./tiered-setting.ts";
import type { Placement } from "./slots/sheet.ts";

const made: unique symbol = Symbol("declared home");

/** How a cell is keyed: one for the whole Work, one per free name, or one per subject. */
export type CellKey = "route" | "name" | "subject";
/** The six questions every home kind answers (ADR 0058 decision 4). The homes table renders them. */
export type HomeCost = {
  readonly readsPerCommand: string;
  readonly placesThatCanDisagree: string;
  readonly setupBeforeFirstUse: string;
  readonly writeBorrows: string;
  readonly sizeLimit: string;
  readonly seenInRevit: string;
};
/** Where a stored fact rests. Only the constructors below make one, so a new kind is a kernel change. */
export type Home<Takes extends CellKey = CellKey> = {
  readonly [made]: "home";
  readonly kind: string;
  readonly rung: 3 | 4 | 5 | 6 | null;
  /** The identity the write door matches exactly (S11). */
  readonly key: string;
  readonly cost: HomeCost;
  /** The cell keys this home can hold. A command may land no other cell here. */
  readonly takes: readonly Takes[];
  /** How a sheet places a cell that lands here (ADR 0032: placement is derived, never per field). */
  readonly place: (cell: string) => Placement;
  readonly settingCells?: readonly string[];
  /** Set by `productRead`: the files here are no cells, and the product's host reads them. */
  readonly read?: "product";
};
/**
 * A home C# declares and writes (ruling 4), identified by its generated handle.
 */
export type NativeHome<Prefix extends string> = {
  readonly [made]: "native";
  readonly key: `${Prefix}:${string}`;
};
export const ownerBlob = (name: keyof typeof ownerBlobs): NativeHome<"owner-blob"> => ({
  [made]: "native",
  key: ownerBlobs[name],
});
export const entity = (name: keyof typeof entities): NativeHome<"entity"> => ({
  [made]: "native",
  key: entities[name],
});
export const machineFileHandle = (name: keyof typeof machineFiles): NativeHome<"machine-file"> => ({
  [made]: "native",
  key: machineFiles[name],
});

/*
 * The home ladder in code (ADR 0058). Ask in order and stop at the first yes: a fact the model can
 * give again is not stored (rung 1), and a fact not applied yet is a cell no command lands (rung 2).
 * Rungs 3 to 6 are the constructors. No bound-parameter constructor exists until a product needs one.
 */
export const platformHomes = [
  {
    key: "Work",
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
] as const;

/** Rung 3: a standard of the firm or the project, in a home file by tier. */
export const homeFile = (
  owner: string,
  tiers: readonly SettingTier[] = SETTING_TIERS,
  paths: Readonly<Record<string, readonly string[]>> = {},
): Home<"route"> => ({
  [made]: "home",
  kind: "home-file",
  rung: 3,
  key: `home-file:${owner}`,
  takes: ["route"],
  settingCells: Object.keys(paths),
  place: (cell) => ({ at: "setting", owner, path: paths[cell] ?? cell.split("."), tiers }),
  cost: {
    readsPerCommand: "One file per tier",
    placesThatCanDisagree: "One per tier: default, firm and document",
    setupBeforeFirstUse: "A firm home, for the firm tier only",
    writeBorrows: "Project Information, for the document tier only",
    sizeLimit: "256 KiB for the document tier",
    seenInRevit: "Nothing",
  },
});
/**
 * A home file whose content is not cells, such as a folder of units. It stays a home file on the
 * same rung; the product's host hands the kernel the reader, and `implement()` refuses without one.
 */
export const productRead = <H extends Home>(home: H): H & { readonly read: "product" } => ({
  ...home,
  read: "product",
});
/** Rung 4: an entity on the element, only where Revit's own calculation must read the fact. */
export const revitEntity = (declared: NativeHome<"entity">): Home<"subject"> => ({
  [made]: "home",
  kind: "revit-entity",
  rung: 4,
  key: declared.key,
  takes: ["subject"],
  place: () => ({ at: "store", store: declared.key }),
  cost: {
    readsPerCommand: "One per element",
    placesThatCanDisagree: "One per element",
    setupBeforeFirstUse: "A schema, which can never gain a field",
    writeBorrows: "The element",
    sizeLimit: "One versioned JSON text per element",
    seenInRevit: "Nothing; Revit's calculation reads it",
  },
});
/** Rung 5: a semantic parameter slot. Its owner's settings resolve the actual Revit name. */
export const familyParameter = (slot: string): Home<"subject"> => ({
  [made]: "home",
  kind: "family-parameter",
  rung: 5,
  key: `parameter:${slot}`,
  takes: ["subject"],
  place: () => ({ at: "parameter", parameter: slot }),
  cost: {
    readsPerCommand: "One per element",
    placesThatCanDisagree: "One per element; a person can edit it in Revit",
    setupBeforeFirstUse: "None; the family already has it",
    writeBorrows: "The element",
    sizeLimit: "One value",
    seenInRevit: "The value, in Properties, tags and schedules",
  },
});
/** Rung 6: Pe's own fact about an element, in the product's one document record keyed by `UniqueId`. */
export const documentRecord = (declared: NativeHome<"owner-blob">): Home => ({
  [made]: "home",
  kind: "document-record",
  rung: 6,
  key: declared.key,
  takes: ["route", "name", "subject"],
  place: () => ({ at: "store", store: declared.key }),
  cost: {
    readsPerCommand: "One, the whole record",
    placesThatCanDisagree: "One",
    setupBeforeFirstUse: "None; the first write binds one hidden parameter",
    writeBorrows: "Project Information, so one person writes a product's facts between syncs",
    sizeLimit: "256 KiB per record, provisional until measure M1",
    seenInRevit: "Nothing: no tag, filter, schedule or Properties row",
  },
});
/**
 * Beside the ladder: evidence a native operation keeps on this machine, such as a solver trace. It
 * holds no cell, because a fact about the model does not rest on one machine. It is on no rung of
 * ADR 0058; owner confirmation pending in the product-declaration run.
 */
export const machineFile = (declared: NativeHome<"machine-file">): Home<never> => ({
  [made]: "home",
  kind: "machine-file",
  rung: null,
  key: declared.key,
  takes: [],
  place: () => ({ at: "local" }),
  cost: {
    readsPerCommand: "One file per subject",
    placesThatCanDisagree: "One per machine",
    setupBeforeFirstUse: "None",
    writeBorrows: "Nothing in the model",
    sizeLimit: "None",
    seenInRevit: "Nothing",
  },
});

/** Beside the ladder: a file whose path the command's input names. */
export const externalFile = (name: string): Home<"name"> => ({
  [made]: "home",
  kind: "external-file",
  rung: null,
  key: `external-file:${name}`,
  takes: ["name"],
  place: () => ({ at: "store", store: `external-file:${name}` }),
  cost: {
    readsPerCommand: "One named file",
    placesThatCanDisagree: "One per file",
    setupBeforeFirstUse: "Supply the file path",
    writeBorrows: "The file",
    sizeLimit: "File format limit",
    seenInRevit: "Nothing",
  },
});
