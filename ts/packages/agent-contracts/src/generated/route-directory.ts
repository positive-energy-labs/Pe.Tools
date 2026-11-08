// Generated from web route graphs by codegen:routes.
import type { RouteDirectory } from "../route-graph.ts";
export const routeDirectory: readonly {key: string; directory: RouteDirectory}[] = [
  {
    "key": "bind",
    "directory": {
      "label": "Document",
      "icon": "Link2",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "document",
        "binding"
      ],
      "runtimeNeed": "Host document bindings",
      "listed": false,
      "satellites": [],
      "path": "/bind",
      "title": "Bind",
      "category": "Start / open work",
      "blurb": "Bind a Page to a document or thread"
    }
  },
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
    "key": "design-system",
    "directory": {
      "label": "Design language",
      "icon": "Palette",
      "exposure": "Preview",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "Design",
        "language"
      ],
      "runtimeNeed": "Browser component catalogue",
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
      "path": "/design-system",
      "title": "Design System",
      "category": "Explore / maintain",
      "blurb": "Production design language, laws and component specimens"
    }
  },
  {
    "key": "duct-loss",
    "directory": {
      "label": "Duct friction",
      "icon": "Wind",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "friction",
        "airflow",
        "pressure",
        "calculator"
      ],
      "runtimeNeed": "Host calculation",
      "listed": true,
      "satellites": [],
      "path": "/duct-loss",
      "title": "Duct Loss",
      "category": "Calculate loads & airflow",
      "blurb": "Calculate duct friction with intermediate terms beside the equation"
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
    "key": "family",
    "directory": {
      "label": "Family Foundry",
      "icon": "Boxes",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "rfa",
        "author",
        "build",
        "capture",
        "matrix"
      ],
      "runtimeNeed": "Revit for capture and apply",
      "listed": true,
      "satellites": [],
      "resume": "document",
      "path": "/family",
      "title": "Family",
      "category": "Build / audit families",
      "blurb": "Inspect saved family profiles, edit cells and review PDF evidence"
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
    "key": "home",
    "directory": {
      "label": "Home",
      "icon": "Home",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [],
      "runtimeNeed": "Host activity and tool directory",
      "listed": false,
      "satellites": [],
      "path": "/",
      "title": "Home",
      "category": "Start / open work",
      "blurb": "Find tools and resume open work"
    }
  },
  {
    "key": "open",
    "directory": {
      "label": "Open document",
      "icon": "Server",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      },
      "aliases": [
        "documents",
        "model",
        "launcher"
      ],
      "runtimeNeed": "Host document discovery and Revit lifecycle",
      "listed": true,
      "satellites": [],
      "path": "/open",
      "title": "Open document",
      "category": "Start / open work",
      "blurb": "Choose a document and its destination Revit"
    }
  },
  {
    "key": "ops",
    "directory": {
      "label": "Host API",
      "icon": "Terminal",
      "exposure": "Preview",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "host",
        "api",
        "operations",
        "playground"
      ],
      "runtimeNeed": "Host; Revit depends on the operation",
      "listed": true,
      "satellites": [],
      "path": "/ops",
      "title": "Ops",
      "category": "Explore / maintain",
      "blurb": "Inspect catalog operations and original action receipts"
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
    "key": "rooms",
    "directory": {
      "label": "Manual J",
      "icon": "LayoutDashboard",
      "exposure": "Preview",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "manual",
        "j",
        "loads",
        "regions"
      ],
      "runtimeNeed": "Revit for room plans and writes",
      "listed": true,
      "satellites": [],
      "resume": "document",
      "path": "/rooms",
      "title": "Rooms",
      "category": "Calculate loads & airflow",
      "blurb": "Inspect room regions, stage loads and review anchored feedback"
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
    "key": "session-admin",
    "directory": {
      "label": "Sessions",
      "icon": "Server",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      },
      "aliases": [
        "session",
        "administration"
      ],
      "runtimeNeed": "Host document discovery and Revit lifecycle",
      "listed": true,
      "satellites": [],
      "path": "/session-admin",
      "title": "Sessions",
      "category": "Start / open work",
      "blurb": "Start, stop or restart one Revit session."
    }
  },
  {
    "key": "settings",
    "directory": {
      "label": "Settings",
      "icon": "Settings2",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": "compact"
      },
      "aliases": [
        "machine",
        "Revit",
        "update",
        "share",
        "providers",
        "approvals",
        "host",
        "theme",
        "preferences"
      ],
      "runtimeNeed": "Host machine configuration",
      "listed": true,
      "satellites": [],
      "path": "/settings",
      "title": "Settings",
      "category": "Explore / maintain",
      "blurb": "This machine and every route's user settings"
    }
  },
  {
    "key": "takeoffs",
    "directory": {
      "label": "Manual J",
      "icon": "Map",
      "exposure": "Main",
      "surfaces": {
        "web": "full",
        "pwa": "full",
        "tray": false
      },
      "aliases": [
        "manual",
        "j",
        "loads",
        "rhvac",
        "zones"
      ],
      "runtimeNeed": "Revit for model actions; browsing saved data is separate",
      "listed": true,
      "satellites": [],
      "resume": "document",
      "path": "/takeoffs",
      "title": "View adoption",
      "category": "Calculate loads & airflow",
      "blurb": "Adopt zoning regions from chosen views."
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
  }
];
