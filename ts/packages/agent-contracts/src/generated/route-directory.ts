// Generated from web route graphs by codegen:routes.
import type { RouteDirectory } from "../route-graph.ts";
export const routeDirectory: readonly {key: string; directory: RouteDirectory}[] = [
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
    }
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
    }
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
    }
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
      "blurb": "Review duct systems, stage inputs and rulings, and plan writes to Revit"
    }
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
    }
  },
  {
    "key": "chat",
    "directory": {
      "label": "Workbench",
      "icon": "MessageSquare",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      },
      "aliases": [
        "chat",
        "agent",
        "assistant",
        "threads"
      ],
      "runtimeNeed": "Host for conversation; Revit depends on the requested capability",
      "listed": true,
      "satellites": [],
      "path": "/pea",
      "title": "Pea",
      "category": "Ask / automate",
      "blurb": "The Pea agent workbench and context world inspector."
    }
  },
  {
    "key": "pods",
    "directory": {
      "label": "Pods",
      "icon": "Settings2",
      "exposure": "Preview",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "Pods"
      ],
      "runtimeNeed": "Host catalogue; Revit depends on the pod",
      "listed": true,
      "satellites": [],
      "path": "/pods",
      "title": "Pods",
      "category": "Ask / automate",
      "blurb": "Author a Pod member and inspect its runs."
    }
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
    }
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
    }
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
    }
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
    }
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
    }
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
    }
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
    }
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
    }
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
    }
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
    }
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
    }
  }
];
