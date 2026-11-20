import { Schema } from "effect";
import type { HostLocalCatalogEntry } from "@pe/host-contracts/operation-types";

// The extract schemas mirror dotnet/Pe.Revit.Takeoff/Rhvac/extract-rhvac.ps1.

export const rhvacPathRequestSchema = Schema.Struct({
  /** Absolute host-visible path to the .r10 project file. */
  path: Schema.String,
});
export type RhvacPathRequest = Schema.Schema.Type<typeof rhvacPathRequestSchema>;

export const rhvacAssemblyOptionSchema = Schema.Struct({
  name: Schema.String,
  uValue: Schema.Number,
  shgc: Schema.optional(Schema.Number),
});

export const rhvacAssemblyCatalogSchema = Schema.Struct({
  sourceFile: Schema.optional(Schema.String),
  floors: Schema.Array(rhvacAssemblyOptionSchema),
  roofs: Schema.Array(rhvacAssemblyOptionSchema),
  walls: Schema.Array(rhvacAssemblyOptionSchema),
  glass: Schema.Array(rhvacAssemblyOptionSchema),
  doors: Schema.Array(rhvacAssemblyOptionSchema),
});
export type RhvacAssemblyCatalogData = Schema.Schema.Type<typeof rhvacAssemblyCatalogSchema>;

/**
 * Everything about a room except its autonumber PK. A room being INSERTED has no PK yet — Jet
 * assigns it — so the insert lane takes these fields alone and reports the assigned identifier back.
 */
const rhvacRoomFields = {
  number: Schema.Number,
  name: Schema.String,
  systemNumber: Schema.Number,
  zoneNumber: Schema.Number,
  areaSquareFeet: Schema.Number,
  ceilingHeightFeet: Schema.Number,
  people: Schema.Number,
  lightingWatts: Schema.Number,
  equipmentSensibleBtuh: Schema.Number,
  equipmentLatentBtuh: Schema.Number,
  ventilationCfm: Schema.Number,
  /** Stored RHVAC calc outputs — read-only, ignored on save. */
  loads: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  floors: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      areaSquareFeet: Schema.Number,
      exposedPerimeterFeet: Schema.Number,
    }),
  ),
  roofs: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      areaSquareFeet: Schema.Number,
      areaMultiplier: Schema.Number,
    }),
  ),
  walls: Schema.Array(
    Schema.Struct({
      /** 1-based wall ordinal — glass/doors point at this via wallReference. */
      index1: Schema.Number,
      assembly: Schema.String,
      uValue: Schema.Number,
      lengthFeet: Schema.Number,
      heightFeet: Schema.Number,
      direction: Schema.Number,
    }),
  ),
  glass: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      widthFeet: Schema.Number,
      heightFeet: Schema.Number,
      wallReference: Schema.Number,
      shgc: Schema.Number,
      occurrences: Schema.Number,
    }),
  ),
  doors: Schema.Array(
    Schema.Struct({
      assembly: Schema.String,
      uValue: Schema.Number,
      widthFeet: Schema.Number,
      heightFeet: Schema.Number,
      wallReference: Schema.Number,
    }),
  ),
} as const;

/** A room being inserted: no `identifier` yet — Jet's COUNTER assigns it. */
export const rhvacInsertRoomSchema = Schema.Struct(rhvacRoomFields);
export type RhvacInsertRoomData = Schema.Schema.Type<typeof rhvacInsertRoomSchema>;

export const rhvacRoomSchema = Schema.Struct({
  /** Room autonumber PK — the edit lane's row target; distinct from `number`. */
  identifier: Schema.Number,
  ...rhvacRoomFields,
});
export type RhvacRoomData = Schema.Schema.Type<typeof rhvacRoomSchema>;

/** Weak .r10 identity: file name plus a stamp over project/client titles. */
export const rhvacFileIdentitySchema = Schema.Struct({
  fileName: Schema.String,
  projectTitle: Schema.String,
  clientName: Schema.String,
  stamp: Schema.String,
});
export type RhvacFileIdentity = Schema.Schema.Type<typeof rhvacFileIdentitySchema>;

export const rhvacExtractSchema = Schema.Struct({
  sourceFile: Schema.String,
  fileIdentity: rhvacFileIdentitySchema,
  building: Schema.Record(Schema.String, Schema.Number),
  systems: Schema.Array(Schema.Struct({ number: Schema.Number, name: Schema.String })),
  rooms: Schema.Array(rhvacRoomSchema),
});
export type RhvacExtractData = Schema.Schema.Type<typeof rhvacExtractSchema>;

export const rhvacSyncRequestSchema = Schema.Struct({
  /** The .r10 to sync IN PLACE — behind a lock check, a working copy, and a timestamped backup. */
  targetPath: Schema.String,
  /** New rooms. Their assigned `identifier`s come back in the result. */
  inserts: Schema.Array(rhvacInsertRoomSchema),
  /** Existing rooms, targeted by `identifier`; written back whole. */
  updates: Schema.Array(rhvacRoomSchema),
  /**
   * Systems the rooms reference. An existing `number` is left exactly as the engineer has it
   * (never renamed); a missing one is seeded by cloning the lowest-numbered System row and
   * overriding number + name only. See eval/rhvac/template/SYSTEM-INSERT-PROBE.md.
   */
  systems: Schema.optional(
    Schema.Array(Schema.Struct({ number: Schema.Number, name: Schema.String })),
  ),
  /** Delete the template's blank Room (Identifier 1) — only if it is still untouched. */
  deleteUntouchedSeedRoom: Schema.optional(Schema.Boolean),
  /** Validate and keep the working copy without swapping the target. */
  whatIf: Schema.optional(Schema.Boolean),
});
export type RhvacSyncRequest = Schema.Schema.Type<typeof rhvacSyncRequestSchema>;

/**
 * Weak by necessity: an .r10 carries NO GUID or stable id anywhere (probed — Project is 9 free-text
 * columns, Client 9, Version 6 build numbers). `stamp` hashes the engineer-facing project + client
 * titles, so it survives copying or renaming the FILE and changes when the project is retitled.
 * All four parts are reported so a caller pairing {fileIdentity, roomIdentifier} into Revit
 * provenance can detect drift rather than silently trust a match.
 */
export const rhvacSyncResultSchema = Schema.Struct({
  targetPath: Schema.String,
  /** Null when nothing was swapped (whatIf). */
  backupPath: Schema.NullOr(Schema.String),
  swapped: Schema.Boolean,
  fileIdentity: rhvacFileIdentitySchema,
  /** Every requested system, with `seeded` false for ones that already existed. */
  systems: Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      name: Schema.String,
      identifier: Schema.Number,
      seeded: Schema.Boolean,
    }),
  ),
  /** Room number -> the Jet-assigned autonumber PK, read back after the insert. */
  insertedRooms: Schema.Array(
    Schema.Struct({ number: Schema.Number, name: Schema.String, identifier: Schema.Number }),
  ),
  updated: Schema.Number,
  seedRoom: Schema.Struct({
    identifier: Schema.Number,
    action: Schema.Literals(["deleted", "kept", "not-requested"]),
    reason: Schema.String,
  }),
  /**
   * Room rows whose assembly was in neither the target file nor the preset catalog: that category was
   * written as one explicit zero row (no load), never a guessed material. Surface these.
   */
  assemblyFallbacks: Schema.Array(
    Schema.Struct({
      roomNumber: Schema.Number,
      roomName: Schema.String,
      category: Schema.String,
      assemblies: Schema.Array(Schema.String),
    }),
  ),
  roomsBefore: Schema.Number,
  roomsAfter: Schema.Number,
  /** The safety envelope's own transcript (lock check, census, validation, swap). */
  log: Schema.String,
});
export type RhvacSyncResult = Schema.Schema.Type<typeof rhvacSyncResultSchema>;

export const rhvacLaunchResultSchema = Schema.Struct({
  path: Schema.String,
  /** True once the shell accepted the open; RHVAC's own startup is not awaited. */
  launched: Schema.Boolean,
});
export type RhvacLaunchResult = Schema.Schema.Type<typeof rhvacLaunchResultSchema>;

/** The legal-options source for the `.r10` binding: every .r10 in one folder. */
export const rhvacListRequestSchema = Schema.Struct({
  /** Absolute host-visible folder. */
  dir: Schema.String,
});
export type RhvacListRequest = Schema.Schema.Type<typeof rhvacListRequestSchema>;
export const rhvacListDataSchema = Schema.Struct({
  dir: Schema.String,
  /** False when the folder does not exist or is unreadable — an empty list then means "no folder", not "no files". */
  exists: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({ name: Schema.String, path: Schema.String, modifiedUnixMs: Schema.Number }),
  ),
});
export type RhvacListData = Schema.Schema.Type<typeof rhvacListDataSchema>;

export const rhvacRoomMapSchema = Schema.Struct({
  matches: Schema.Array(Schema.Struct({ oracleNumber: Schema.Number, candidate: Schema.String })),
  skip: Schema.Array(Schema.Struct({ oracleNumber: Schema.Number, reason: Schema.String })),
});

/** Raw takeoff snapshots next to the .r10 — the client parses the TSV texts itself. */
export const rhvacTakeoffDataSchema = Schema.Struct({
  tsvs: Schema.Array(
    Schema.Struct({ name: Schema.String, text: Schema.String, sha256: Schema.String }),
  ),
  roomMap: Schema.NullOr(rhvacRoomMapSchema),
});
export type RhvacTakeoffData = Schema.Schema.Type<typeof rhvacTakeoffDataSchema>;

export const localOperationSchemas = {
  "takeoffs.saved": {
    request: Schema.Struct({
      captureId: Schema.optional(Schema.String),
      document: Schema.optional(Schema.String),
      text: Schema.optional(Schema.Boolean),
    }),
    response: Schema.Unknown,
  },
  "rhvac.open": {
    request: rhvacPathRequestSchema,
    response: rhvacExtractSchema,
  },
  "rhvac.assemblies": {
    request: rhvacPathRequestSchema,
    response: rhvacAssemblyCatalogSchema,
  },
  "rhvac.sync": {
    request: rhvacSyncRequestSchema,
    response: rhvacSyncResultSchema,
  },
  "rhvac.launch": {
    request: rhvacPathRequestSchema,
    response: rhvacLaunchResultSchema,
  },
  "rhvac.takeoff": {
    request: rhvacPathRequestSchema,
    response: rhvacTakeoffDataSchema,
  },
  "rhvac.list": {
    request: rhvacListRequestSchema,
    response: rhvacListDataSchema,
  },
} as const;

type CatalogEntry = HostLocalCatalogEntry<keyof typeof localOperationSchemas>;
const catalogRow = (
  row: Pick<
    CatalogEntry,
    "key" | "displayName" | "description" | "requestTypeName" | "responseTypeName" | "searchTerms"
  > &
    Partial<Pick<CatalogEntry, "effect" | "costTier">>,
): CatalogEntry => ({
  subject: "None",
  touches: "Metadata",
  cardinality: "One",
  effect: "Read",
  origin: "host-local",
  visibility: "DefaultVisible",
  costTier: "Cheap",
  needs: "nothing",
  ...row,
});

export const localOperationCatalog = [
  catalogRow({
    key: "takeoffs.saved",
    displayName: "Saved Takeoffs captures",
    description:
      "Read durable geometry without Revit. With captureId, return that immutable dated capture. Otherwise list capture identities, times and documents; optional document filters the list. Migrated captures explicitly have unknown original target provenance and are never live evidence.",
    requestTypeName: "SavedTakeoffsRequest",
    responseTypeName: "TakeoffCapture",
    searchTerms: ["takeoffs", "saved", "capture", "offline", "geometry", "review"],
  }),
  catalogRow({
    key: "rhvac.open",
    displayName: "Open RHVAC Project",
    description:
      "Extract an Elite RHVAC .r10 Manual J project to JSON: building totals, systems, and rooms with identifiers. Runs the repo's 32-bit Jet lane; no Revit session needed.",
    costTier: "Bounded",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacExtractData",
    searchTerms: ["rhvac", "r10", "manual j", "open", "extract", "rooms", "loads"],
  }),
  catalogRow({
    key: "rhvac.assemblies",
    displayName: "RHVAC Assemblies",
    description:
      "Distinct construction assemblies per category (floors/roofs/walls/glass/doors) used in an .r10 file, with U-values (glass: + SHGC). The editor's assembly picker source.",
    costTier: "Bounded",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacAssemblyCatalogData",
    searchTerms: ["rhvac", "r10", "assemblies", "constructions", "u-value", "materials"],
  }),
  catalogRow({
    key: "rhvac.sync",
    effect: "SessionWrite",
    displayName: "Sync RHVAC Project",
    description:
      "One atomic sync of an .r10 IN PLACE: seed systems, insert new rooms, update existing ones, optionally drop the template's blank seed room. Refuses while RHVAC holds the file, works on a copy, validates, then swaps with a timestamped backup. Returns each inserted room's assigned identifier plus the file identity to pair with Revit provenance.",
    costTier: "Mutation",
    requestTypeName: "RhvacSyncRequest",
    responseTypeName: "RhvacSyncResult",
    searchTerms: [
      "rhvac",
      "r10",
      "sync",
      "export",
      "insert",
      "rooms",
      "systems",
      "takeoff",
      "backup",
    ],
  }),
  catalogRow({
    key: "rhvac.launch",
    effect: "SessionWrite",
    displayName: "Open .r10 in RHVAC",
    description:
      "Open an .r10 file with its Windows file association (Elite RHVAC). Fire-and-forget: the shell owns the app, and load recalculation is a manual step in RHVAC.",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacLaunchResult",
    searchTerms: ["rhvac", "r10", "launch", "open", "start", "elite", "shell"],
  }),
  catalogRow({
    key: "rhvac.list",
    displayName: "List .r10 files",
    description:
      "List the .r10 Manual J project files in one host-visible folder. The legal-options source for a route's .r10 binding; a missing folder is an empty list with exists=false.",
    requestTypeName: "RhvacListRequest",
    responseTypeName: "RhvacListData",
    searchTerms: ["rhvac", "r10", "list", "folder", "files", "manual j"],
  }),
  catalogRow({
    key: "rhvac.takeoff",
    displayName: "RHVAC Takeoff Snapshots",
    description:
      "Raw takeoff TSV snapshots (<dir>/takeoff/*.tsv) and room-map.json found next to an .r10 file. Empty result when none exist.",
    requestTypeName: "RhvacPathRequest",
    responseTypeName: "RhvacTakeoffData",
    searchTerms: ["rhvac", "takeoff", "tsv", "room map", "plan", "polygons"],
  }),
];
