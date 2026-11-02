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
    "moduleHash": "b63b1db5fa53b5ce7bcdd2d23c3445ac455fcb9a2282736f21df63cfc3623fa5"
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
    "moduleHash": "52c1ed26f75c4f6ec7def8f5a1f7d513c367c53f7a6dcc2ced17c47202ede4b3"
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
    "moduleHash": "8406e6d046b333e10f0f523b749366091c8a6ba9089a5eb68ba8783e5f8c5c4c"
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
    "moduleHash": "d195926c81beef734644e2b0007b2fde8e12b12e45b7667cfa53cd704b16bd04"
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
    "moduleHash": "3aeab48f52ee768555e4dfbe23689a73e28bdd97571ca06716d45c82cccd8f32"
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
    "moduleHash": "1c839aec8bf2c6ee816f6018ae0c08c3bbd16b52bf4931d297cca67f6e7b0289"
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
      "blurb": "Every loaded family's types × parameters in one table — audit it against a profile, plan the reconciliation, apply with receipts.",
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
      },
      "resume": "document"
    },
    "moduleHash": "5a8cd860a287170b322003568fdef7a5345400d8484974b027b559a97553b284"
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
      },
      "resume": "document"
    },
    "moduleHash": "aa2f2a1fea45d38aa170b6e96b1b31e475d025615a1c383c7593d5d67cacf139"
  },
  {
    "key": "fans",
    "directory": {
      "path": "/fans",
      "title": "Fans",
      "label": "Fan air paths",
      "exposure": "Main",
      "runtimeNeed": "Revit for model reads and writes",
      "icon": "Wind",
      "category": "Calculate loads & airflow",
      "blurb": "Review duct systems, stage pressure-drop inputs and rulings, and preview or apply the changes in Revit.",
      "aliases": [
        "fan",
        "ESP",
        "air path"
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
    "moduleHash": "5e090f5c41f608c332ebce67642320a1d370236c8f022699a6113e9354c612bc"
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
    "moduleHash": "ec7b33e4f1eabcdd53dc71b86502f99b92720f59658930bfcc4bbc18bf17e5a4"
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
    "moduleHash": "ae9dfe5435f78eb350b58399e1870a098aca0e35ee73610f41c0438c547748f2"
  },
  {
    "key": "instances",
    "directory": {
      "path": "/open",
      "title": "Open document",
      "label": "Revit",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Server",
      "category": "Start / open work",
      "blurb": "Choose a document and its destination Revit.",
      "aliases": [
        "documents",
        "model",
        "launcher"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      }
    },
    "moduleHash": "21350399cdd3bfa321c971648748cf070e1af3ed744a2169a6c17e42fdd1f29a"
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
    "moduleHash": "582dfdc9d0c6cefe3c1769f22c404efd1221c3d925ae5878a51f02299d1768d6"
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
    "moduleHash": "87bc88cc7c48d186077e311088b03803b29c025791a7243020963026c35505af"
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
      "blurb": "Cross-element parameter links â€” co-edit the link profile with pea, preview the projected target writes, then apply to reconcile them.",
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
    "moduleHash": "7ff16dfc9b3f2a730c2cf0ef74276419ac274fcd966011648bd16afbac6e4368"
  },
  {
    "key": "pod-admin",
    "directory": {
      "path": "/pod-admin",
      "title": "Pod administration",
      "label": "Pod administration",
      "icon": "Settings2",
      "category": "Ask / automate",
      "exposure": "Preview",
      "runtimeNeed": "Host",
      "blurb": "Install Pods and manage activation and executable route trust.",
      "aliases": [
        "install",
        "trust",
        "plugins"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      }
    },
    "moduleHash": "70dccdaa2add51f12d415ee079b51169bcc784f3e50900ca0e0c8846faeb7a56"
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
      "blurb": "Author a Pod member and inspect its runs.",
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
    "moduleHash": "0af8c753d84cbbccee0aa77707b00217a774e7f069abb6efdc700fd9b1b44eb3"
  },
  {
    "key": "rhvac-sync",
    "directory": {
      "path": "/rhvac-sync",
      "title": "RHVAC sync",
      "label": "Manual J",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Map",
      "category": "Calculate loads & airflow",
      "blurb": "Sync selected zones to one RHVAC file.",
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
    "moduleHash": "a6307c66c9aa973f1e22181273bd9a606cf4493da94a0aa647f7d828dd975200"
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
    "moduleHash": "0f0d2e58faba51098f6b953dbd88f336383539b17a39064031c426962df22318"
  },
  {
    "key": "schedule-specs",
    "directory": {
      "path": "/schedule-specs",
      "title": "Schedule definitions",
      "label": "Revit data",
      "exposure": "Preview",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "LayoutGrid",
      "category": "Coordinate model data",
      "blurb": "Author a saved schedule definition and apply it as a new schedule.",
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
      },
      "resume": "document"
    },
    "moduleHash": "1bae867e978c9291afce4f6cdb0aea0ab9a84a7ca33953b5fc6f92b8f2f27001"
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
      "blurb": "Inspect, edit and review the history of a document schedule.",
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
      },
      "resume": "document"
    },
    "moduleHash": "cd9a685270631eb290ce3bd988f50eaac2800e19032f670e4a523cc5fb2dac13"
  },
  {
    "key": "session-admin",
    "directory": {
      "path": "/session-admin",
      "title": "Sessions",
      "label": "Revit",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Server",
      "category": "Start / open work",
      "blurb": "Start, stop or restart one Revit session.",
      "aliases": [
        "session",
        "administration"
      ],
      "listed": true,
      "satellites": [],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      }
    },
    "moduleHash": "bb576af4553e5df659977c3b1f907437d31d7faf340152b66fddd3cc8305e49e"
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
    "moduleHash": "e2e4999145c97087d973eefa3ece0448fb43fafa0908c4602525d9a33394d862"
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
    "moduleHash": "96c71f7fe43eeb925c2c0d604f70bd8a2735da04315670c8eed8334f4b39db9b"
  },
  {
    "key": "takeoffs",
    "directory": {
      "path": "/takeoffs",
      "title": "View adoption",
      "label": "Manual J",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Map",
      "category": "Calculate loads & airflow",
      "blurb": "Adopt zoning regions from chosen views.",
      "aliases": [
        "manual",
        "j",
        "loads",
        "rhvac",
        "zones"
      ],
      "listed": true,
      "satellites": [
        {
          "to": "/zone-audit",
          "label": "Zone audit"
        }
      ],
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "resume": "document"
    },
    "moduleHash": "17406749a79a1f3ee7fadc5dd8b9f9e7c0df1451593c4a58bb0569e1849b1a3e"
  },
  {
    "key": "zone-audit",
    "directory": {
      "path": "/zone-audit",
      "title": "Zone audit",
      "label": "Manual J",
      "exposure": "Main",
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "icon": "Map",
      "category": "Calculate loads & airflow",
      "blurb": "Audit rooms in selected zones.",
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
    "moduleHash": "a9fa7f1a0573d61b5a4407e15d05b441502b88d2bb0ca9f277b917605b5dabe2"
  }
];
