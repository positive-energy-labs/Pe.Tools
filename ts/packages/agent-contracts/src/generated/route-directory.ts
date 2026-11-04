// Generated from web route graphs by codegen:routes.
import type { RouteDirectory } from "../route-graph.ts";
export const routeDirectory: readonly {key: string; directory: RouteDirectory; moduleHash: string}[] = [
  {
    "key": "captures",
    "directory": {
      "label": "Revit data",
      "icon": "Image",
      "exposure": "Preview",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "Revit",
        "data"
      ],
      "runtimeNeed": "Host retained view images",
      "listed": true,
      "satellites": [],
      "path": "/captures",
      "title": "Captures",
      "category": "Coordinate model data",
      "blurb": "Inspect retained view pictures and receipts"
    },
    "moduleHash": "293d94cb10d7704be7eea5a479c4a4cf322bdae664213ad7c5d7c35d022f9eb6"
  },
  {
    "key": "schedules",
    "directory": {
      "label": "Revit data",
      "icon": "LayoutGrid",
      "exposure": "Preview",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "Revit",
        "data"
      ],
      "runtimeNeed": "Open project document",
      "listed": true,
      "satellites": [],
      "resume": "document",
      "path": "/schedules",
      "title": "Schedules",
      "category": "Coordinate model data",
      "blurb": "Inspect document schedules"
    },
    "moduleHash": "c6491a663957a64b78e4b210ea6126169139ce9c2b95c91489d82a8974db1b76"
  },
  {
    "key": "families",
    "directory": {
      "label": "Family Foundry",
      "icon": "Table2",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "audit",
        "parameters"
      ],
      "runtimeNeed": "Revit for model actions",
      "listed": true,
      "satellites": [],
      "resume": "document",
      "path": "/families",
      "title": "Families",
      "category": "Build / audit families",
      "blurb": "Audit and reconcile loaded family parameters"
    },
    "moduleHash": "79f2745902e8c431d6f0d53f0c8f64533ae48a9d9d76b7bb9c25395ad55788b0"
  },
  {
    "key": "ducts",
    "directory": {
      "label": "Pressure drop",
      "icon": "Wind",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "duct",
        "pressure",
        "airflow",
        "systems"
      ],
      "runtimeNeed": "Revit for model reads and writes",
      "listed": true,
      "satellites": [],
      "resume": "document",
      "path": "/ducts",
      "title": "Ducts",
      "category": "Calculate loads & airflow",
      "blurb": "Review duct systems, stage inputs and rulings, and preview writes in Revit"
    },
    "moduleHash": "6b1e5ab564f26ac74469ea8befa081e00483e3cdcc2ee9fe4bdef21f9c7b030b"
  },
  {
    "key": "fans",
    "directory": {
      "label": "Fan ESP",
      "icon": "Wind",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "fan",
        "ESP",
        "pressure"
      ],
      "runtimeNeed": "Revit for model reads and writes",
      "listed": true,
      "satellites": [],
      "resume": "document",
      "path": "/fans",
      "title": "Fans",
      "category": "Calculate loads & airflow",
      "blurb": "Inspect fan paths, inputs and pressure requirements"
    },
    "moduleHash": "95e9620e9fd025041b1a91ee257a4265bedcde37835d68170970cb7d215a94b9"
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
    "moduleHash": "66fd5683e0b2a6d8216ab1648c79a57bd9f85773db0da5f3a24afd5be0879951"
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
    "moduleHash": "10958e695996a49f3ae3c67ab46d0e03e774d386bedea4fb2a1e9d85c2b5cec8"
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
    "moduleHash": "c67f3f03ad939e1760ce3fa03fbd0751384bd01b1f154bed717f2c8d4b6e034b"
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
    "moduleHash": "6043488b0e198500d8e491eeefca589d36c323240a359b573799bb8778852c78"
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
    "moduleHash": "ca36d65ba803b028db1550c95d747b798cbb42c50892b39ac94d7c1972c38111"
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
    "moduleHash": "ff9b3a8396bb491719bbbb279520d9a4ef6867eb34a5458c540b57777e9650dd"
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
