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
    "moduleHash": "e86b1703514da8b39e8edd4791655b3ec95cf1a6e1d26858e5151e498b9d5a23"
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
    "moduleHash": "271d5b9bc0ea3cbc5a57f4117dd99755974d85aaaf3bbe39c83bbeb3f517909c"
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
    "moduleHash": "748a3a5873293f43f62dc6f35dea89e96cf930b85903674411a703a7103393f7"
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
    "moduleHash": "227d79605ba19d94f9fcb83694350cac096483d1f3930634e5c8064c8e708333"
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
    "moduleHash": "3cbfe8b9ffc9d169d39b885feb1518ed1c65b152b220c243d113e47e233ec97b"
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
    "moduleHash": "a552b21e05f0865ec93b93aabf9ec7aca2f2736d180e8600e6d732d1e049fb7f"
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
    "moduleHash": "718555a5beb7604805ab0e75b28c8e61d45f0eab23881799eddf91f25f08bc16"
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
    "moduleHash": "16414417800003edf66bf1ad8a02e79a9a44bb5f650517d5501bd8ee79945871"
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
    "moduleHash": "e9b25cb807d78abd93045669a45572f8a60732a29671173cde54ba0098b670eb"
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
    "moduleHash": "2323c2c560aef90414cdd5022b5c701e353f9d80c2617d7037858f58095d32f6"
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
    "moduleHash": "a12b1343a126d70ea545efed2269837ac930ea1c322dfccaf57f8d45959ad7a8"
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
    "moduleHash": "1841fe5b092402f808e1ce0c95b72af9210ef440c9cc047ff27fcfa693f48692"
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
    "moduleHash": "eaa3420e711607149d67edb328295c4d83a6f12167fc8d53958fe0b5aefcb76c"
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
    "moduleHash": "4ccad94c771c5ce8f798b0df7384d8fc779744582fd7712792c8777408099946"
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
    "moduleHash": "e30fb2e959d144c9501898b73dbf3945cb7b013ce86c6678e71c2d25060a173b"
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
    "moduleHash": "c538291b5e1f06f0abd95b172ce8becd1bd4c1066b585a2604950f86a737af2d"
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
    "moduleHash": "9d7dd0cb059fe7b3ce2202934233807d3db90dadfb6587ce1861401052f5aa3e"
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
    "moduleHash": "913a44c968944c3169874cb26e17527cad8f1112cae9794b7b361e11f2c92581"
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
    "moduleHash": "130c03fd3a12df48381cd5985570f6d51e1e64685fed745d10bcfaa2d4c23b79"
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
    "moduleHash": "0f6f8ead6b3859e42ca363f395f1659d3f0f426bc3393d458b47111a665d98e0"
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
    "moduleHash": "fb5c81d39bc8a5a279f7f0473c9c51896c432aa2d739fd09015a37f51fd46be0"
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
    "moduleHash": "f0a3279b2f24cf03446cc3bfbff0c448792bb64b267187e664391717dacbf0c7"
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
    "moduleHash": "188f966c58e66c1da506ef0802ddf5c61e7342de7bb3a24817478eeecaecfc62"
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
    "moduleHash": "9ee3ffdc5951866210b2c624f48264c72335486f7390d2cc889eea7653b2c016"
  }
];
