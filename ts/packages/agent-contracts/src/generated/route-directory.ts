// Generated from web route graphs by codegen:routes.
import type { RouteDirectory } from "../route-graph.ts";
export const routeDirectory: readonly {key: string; directory: RouteDirectory; moduleHash: string}[] = [
  {
    "key": "captures",
    "directory": {
      "path": "/captures",
      "title": "Captures",
      "label": "Revit data",
      "exposure": "Preview",
      "runtimeNeed": "Host retained view images",
      "icon": "Image",
      "category": "Coordinate model data",
      "blurb": "Every picture taken of a Revit view, newest first — who took it, which view, the receipt, and the URL a page or a chat links.",
      "aliases": [
        "Revit",
        "data"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "e562f16c11c61091536c7c81886e59ff15bc364a387514cbd7c515dfb4c4379b"
  },
  {
    "key": "chat",
    "directory": {
      "path": "/pea",
      "title": "Pea",
      "label": "Workbench",
      "exposure": "Main",
      "runtimeNeed": "Host for conversation; Revit depends on the requested capability",
      "icon": "MessageSquare",
      "category": "Ask / automate",
      "blurb": "The Pea agent workbench — chat and the context world inspector.",
      "aliases": [
        "chat",
        "agent",
        "assistant",
        "threads"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      }
    },
    "moduleHash": "04eb7055143667c0de679bac9cc568dc94985a162aadd422ca521aacacba087d"
  },
  {
    "key": "data-tables",
    "directory": {
      "path": "/data-tables",
      "title": "Data Tables",
      "label": "Revit data",
      "exposure": "Preview",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Table",
      "category": "Coordinate model data",
      "blurb": "Author synthetic data tables — draft columns and keyed rows, then upsert them in one apply; rows deleted here are pruned in Revit.",
      "aliases": [
        "Revit",
        "data"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "f79671e3a7a8fdadc168727a6274e35387af92d22a4b45117cd2f3cfab0e937c"
  },
  {
    "key": "design-system",
    "directory": {
      "path": "/design-system",
      "title": "Design System",
      "label": "Design language",
      "exposure": "Preview",
      "runtimeNeed": "Browser component catalogue",
      "icon": "Palette",
      "category": "Explore / maintain",
      "blurb": "The spec and catalogue for the design language â€” production components under production tokens, with the gaps they cannot yet express marked in place.",
      "aliases": [
        "Design",
        "language"
      ],
      "listed": true,
      "satellites": [
        {
          "to": "/design-system/band",
          "label": "band"
        },
        {
          "to": "/design-system/list",
          "label": "list"
        },
        {
          "to": "/design-system/arming",
          "label": "arming"
        },
        {
          "to": "/design-system/popovers",
          "label": "popovers"
        },
        {
          "to": "/design-system/swatch",
          "label": "swatch"
        },
        {
          "to": "/design-system/revit",
          "label": "revit"
        }
      ],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "15bf7539f0f6e6561af9386bef80205c702a9cadec40eb84857e7c7e3c3975bb"
  },
  {
    "key": "duct-loss",
    "directory": {
      "path": "/duct-loss",
      "title": "Duct Loss",
      "label": "Duct friction",
      "exposure": "Main",
      "runtimeNeed": "Browser calculation",
      "icon": "Wind",
      "category": "Calculate loads & airflow",
      "blurb": "The imperial duct friction loss formula, live — type a duct and airflow, read Δp with every intermediate term beside the equation.",
      "aliases": [
        "friction",
        "airflow",
        "pressure",
        "calculator"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "9af3fee88b8a26f16fd403548d4c538f41323cafffdb5262487f5afecde2705b"
  },
  {
    "key": "ducts",
    "directory": {
      "path": "/ducts",
      "title": "Ducts",
      "label": "Pressure drop",
      "exposure": "Main",
      "runtimeNeed": "Revit for model reads and writes",
      "icon": "Wind",
      "category": "Calculate loads & airflow",
      "blurb": "Review duct systems, stage pressure-drop inputs and rulings, and preview or apply the changes in Revit.",
      "aliases": [
        "duct",
        "pressure",
        "drop",
        "static",
        "pressure",
        "airflow",
        "fan",
        "systems"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "resume": "document"
    },
    "moduleHash": "94a01629644a6f2a9df47383f9c918bdc4c60db08d669c9c6c2b810741bbcdff"
  },
  {
    "key": "families",
    "directory": {
      "path": "/families",
      "title": "Families",
      "label": "Family Foundry",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Table2",
      "category": "Build / audit families",
      "blurb": "Every loaded family's types Ã— parameters in one table â€” audit it against a profile, plan the reconciliation, apply with receipts.",
      "aliases": [
        "audit",
        "reconcile",
        "parameters",
        "types"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "d94f149399002d6579a7e474142341132e6a2dcb78850c25a672d803a2cf866e"
  },
  {
    "key": "family",
    "directory": {
      "path": "/family",
      "title": "Family",
      "label": "Family Foundry",
      "exposure": "Main",
      "runtimeNeed": "Revit for capture/apply; portable authoring is separate",
      "icon": "Boxes",
      "category": "Build / audit families",
      "blurb": "One family, two lanes: an authored family.json (anatomy, matrix, build) or the family open in Revit's editor. Binding picks the lane; capture bridges them.",
      "aliases": [
        "rfa",
        "author",
        "build",
        "capture",
        "matrix"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "781abee7ef55290756b90cc093b4289e0d26634014d43d0e77bedf0bdeb93068"
  },
  {
    "key": "grilles",
    "directory": {
      "path": "/grilles",
      "title": "Grilles",
      "label": "Wood floor grille",
      "exposure": "Main",
      "runtimeNeed": "Browser calculation and export",
      "icon": "LayoutGrid",
      "category": "Calculate loads & airflow",
      "blurb": "The custom wood floor grille calculator — profiles in a sheet, the active one drawn to submittal scale, the buildable field charted; export a sheet to PDF or .svg.",
      "aliases": [
        "wood",
        "floor",
        "submittal",
        "calculator",
        "pdf",
        "svg"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "16125caca910ee8185f702eead17619c18e1b8fe31e2af1928a95326c889e2e2"
  },
  {
    "key": "index",
    "directory": {
      "path": "/",
      "title": "Tools",
      "label": "Tools",
      "exposure": "Main",
      "runtimeNeed": "Host navigation",
      "icon": "LayoutGrid",
      "category": "Explore / maintain",
      "blurb": "Tools and saved work",
      "aliases": [
        "home",
        "tools",
        "directory"
      ],
      "listed": false,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "1e1ea4deb22535c0aa287bef30843fa75c55ad027adb7e7d1d23d5f2becb1001"
  },
  {
    "key": "instances",
    "directory": {
      "path": "/open",
      "title": "Open",
      "label": "Revit",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Server",
      "category": "Start / open work",
      "blurb": "Start a Revit, open a model, and see which Revit holds it: the launcher, every recent document across installed years, and each running Revit with its shape, documents and verbs.",
      "aliases": [
        "launcher",
        "model",
        "session",
        "documents"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      }
    },
    "moduleHash": "b54a2f5318d787e357687608295dc087ed261afaa9d549cf0124306eb09a0d18"
  },
  {
    "key": "ops",
    "directory": {
      "path": "/ops",
      "title": "Ops Playground",
      "label": "Host API",
      "exposure": "Preview",
      "runtimeNeed": "Host operation; Revit depends on the operation",
      "icon": "Terminal",
      "category": "Explore / maintain",
      "blurb": "Inspect operation requests and action receipts, and run host reads.",
      "aliases": [
        "host",
        "api",
        "operations",
        "playground"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "04833e8a2ebe935c433b82c624c397ef60489414f959f0d4146d56645711c040"
  },
  {
    "key": "bind",
    "directory": {
      "path": "/bind",
      "title": "Bind",
      "label": "Document",
      "exposure": "Main",
      "runtimeNeed": "Host document bindings",
      "icon": "Link2",
      "category": "Start / open work",
      "blurb": "Bind a document",
      "aliases": [
        "document",
        "binding"
      ],
      "listed": false,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "54e67e5be41274e0f4e0a962cfe024991caf5ca20f8d9f80d1ee7f76dd393c11"
  },
  {
    "key": "parameter-links",
    "directory": {
      "path": "/parameter-links",
      "title": "Parameter Links",
      "label": "Revit data",
      "exposure": "Preview",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Link2",
      "category": "Coordinate model data",
      "blurb": "Cross-element parameter links — co-edit the link profile with pea, preview the projected target writes, then apply to reconcile them.",
      "aliases": [
        "Revit",
        "data"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "7ed3ee013f05ea3c7a6aaf3775ba0f2cff46a69d0b4fe74c29f4559379befe35"
  },
  {
    "key": "pods",
    "directory": {
      "path": "/pods",
      "title": "Pods",
      "label": "Pods",
      "exposure": "Preview",
      "runtimeNeed": "Host catalogue; Revit depends on the pod",
      "icon": "Settings2",
      "category": "Ask / automate",
      "blurb": "Every installed pod — browse members, edit a spec as a form or raw JSON, and see the runs filed against it.",
      "aliases": [
        "Pods"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "2b158b02e456901952fa6bda9733043d334f98ccb3ccd7a19946c7f9bf70256a"
  },
  {
    "key": "rooms",
    "directory": {
      "path": "/rooms",
      "title": "Rooms",
      "label": "Manual J",
      "exposure": "Preview",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "LayoutDashboard",
      "category": "Calculate loads & airflow",
      "blurb": "Split a level's plan view into room regions, stage each room's name, type and loads, and write them to the regions in Revit.",
      "aliases": [
        "manual",
        "j",
        "loads",
        "regions"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "resume": "document"
    },
    "moduleHash": "d583a985c23caff9dc67db11d4734ab97768525a77a710320d628fa662fd232f"
  },
  {
    "key": "schedules",
    "directory": {
      "path": "/schedules",
      "title": "Schedules",
      "label": "Revit data",
      "exposure": "Preview",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "LayoutGrid",
      "category": "Coordinate model data",
      "blurb": "Any Revit schedule as a grid â€” push staged cell values, capture its definition into a pod, or apply a saved spec as a new schedule.",
      "aliases": [
        "Revit",
        "data"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "7da467c98f7fa0fe64d1e6ce4661ee998574f7f2edadf7498df73226e41c2216"
  },
  {
    "key": "settings",
    "directory": {
      "path": "/settings",
      "title": "Settings",
      "label": "Settings",
      "exposure": "Main",
      "runtimeNeed": "Host machine configuration",
      "icon": "Settings2",
      "category": "Explore / maintain",
      "blurb": "This machine and every route's user settings: Revit sessions, update, sharing, Pea providers and approvals, host, notifications, appearance, diagnostics, and route preferences.",
      "aliases": [
        "machine",
        "Revit",
        "update",
        "share",
        "providers",
        "sign-in",
        "approvals",
        "host",
        "startup",
        "diagnostics",
        "theme",
        "route",
        "preferences",
        "slots",
        "colours"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      }
    },
    "moduleHash": "b5d2a07d41ba836ef037b2fd5bb565c46030f19ce13310d508a8357f3720b03a"
  },
  {
    "key": "space",
    "directory": {
      "path": "/space",
      "title": "Space",
      "label": "MEP context",
      "exposure": "Preview",
      "runtimeNeed": "Revit for capture; saved scenes open without Revit",
      "icon": "Boxes",
      "category": "Coordinate model data",
      "blurb": "Inspect real model geometry, select elements, and draw straight or bent sections locally.",
      "aliases": [
        "3d",
        "mesh",
        "section",
        "viewer",
        "spatial",
        "context"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "c5948b5957f7f80481c35646817bd367d951775108ff3ddece7d5e7dd1295fcc"
  },
  {
    "key": "takeoffs",
    "directory": {
      "path": "/takeoffs",
      "title": "Takeoffs",
      "label": "Manual J",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Map",
      "category": "Calculate loads & airflow",
      "blurb": "The takeoff atlas — zones on the plan, rooms in the table, Manual J data through to a synced RHVAC .r10.",
      "aliases": [
        "manual",
        "j",
        "loads",
        "rhvac",
        "zones"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "resume": "document"
    },
    "moduleHash": "c64cd88f4a79fcb3e7473decfffc8d40715a326e09fe2b614e8279d7a3875fff"
  }
];
