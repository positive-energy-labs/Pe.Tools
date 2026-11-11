import { icons } from "lucide-react";
import { ROUTE_DIRECTORY } from "@pe/agent-contracts";

// ponytail: the whole icon set ships so a route names any Lucide icon; codegen:routes refuses an
// unknown name. Per-icon lazy loading (lucide-react/dynamic) when the bundle weight matters.
export const TOOLS = ROUTE_DIRECTORY.filter((route) => route.directory).map((route) => ({
  ...route,
  to: route.path,
  icon: icons[route.iconKey as keyof typeof icons],
}));
