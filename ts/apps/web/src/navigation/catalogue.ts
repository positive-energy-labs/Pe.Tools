import { icons } from "lucide-react";
import { ROUTE_DIRECTORY } from "@pe/agent-contracts";

// ponytail: the whole icon set ships so a route names any Lucide icon; codegen:routes refuses an
// unknown name. kaitpw 2026-11-10: accepted, a local app served from localhost (+635 KiB gzip, first
// chunk 1,134 -> 1,636 KiB). Ceiling: first-chunk parse time; then codegen emits the names in use.
export const TOOLS = ROUTE_DIRECTORY.filter((route) => route.directory).map((route) => ({
  ...route,
  to: route.path,
  icon: icons[route.iconKey as keyof typeof icons],
}));
