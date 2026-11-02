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
    "moduleHash": "fd86854bec294b147a3bb02fe210396deb579be71cc8460059da98749e5466b6"
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
    "moduleHash": "14e27267f1daa3337a74e239cf6a061de0458bd7fe0017c8d4d93b2c1cc48f65"
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
    "moduleHash": "e8b13eaacc19a5a1a7e13cc2ac07379bfc25c2aae462bb713d5404b772373acf"
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
    "moduleHash": "5871efc52a17b40f0943c7c6c086d89ca8ec9f793906b2135e2c4a296a2cc659"
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
    "moduleHash": "d87f4e0cdab6b2b824af576930ebdfccb9ebf30bb206a41e4bd312fa7f6bb422"
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
    "moduleHash": "850e49cc3edff4a537ba41cfaf33af0bf4057628e8daf8cda94829b9c736ccff"
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
    "moduleHash": "12e1d32d8e10bf3cdd3bbf0ed2a798810cc65c5a7e0152eb3e35bf2739b0f64c"
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
    "moduleHash": "4883742d9f93c99e952910636fdb2257fbae38b460ff1a979d1177afc91f7a79"
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
    "moduleHash": "c2a323be4d8fd74c29044c4b646aef2b987b87b97b54109c529b0acc62d324bb"
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
    "moduleHash": "18340aaf88781f08fa803a93ac7b4b47887d26499f05309ea1d6a3394d82be44"
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
    "moduleHash": "f3b95174d1af4e84b1c53dcf944b5edac14af0b3eb074641aca41fce5a2d08c5"
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
    "moduleHash": "50a3336721d01dde07d61335d972fec033aea85ffa478937af9d53152a523d0a"
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
    "moduleHash": "5abd2c8cb0c510439f322db1968468aa667f13b2bf82ce778b9aa1e37e050ecf"
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
    "moduleHash": "0bb831592f493d8fc021a7e7c8b395d632836c37af3d233edf130adf107d3373"
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
    "moduleHash": "7fbca53c3d5178bc95bda115d731f6a626551fcbc6883a1073b0ebbe7361aba2"
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
    "moduleHash": "7d1830bc5d82062cc737c693d79ce512455f47e88744329a560668018af590ad"
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
    "moduleHash": "e0ff5d0bf8b24988412449724cec5ce1086d0c2d888c7843e6b1b1937ab8a067"
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
    "moduleHash": "2965661464fe8dcc1dee4d9e79a3e31f999e6c3718ba658cd63c382b4f3a4e35"
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
