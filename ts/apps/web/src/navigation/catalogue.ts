import {
  FileScan,
  FlaskConical,
  Image,
  Boxes,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  Map,
  MessageSquare,
  Palette,
  Server,
  Settings2,
  Table,
  Table2,
  Terminal,
  Wind,
} from "lucide-react";
import { APP_ROUTES } from "@pe/agent-contracts";

const ICONS = {
  FileScan,
  FlaskConical,
  Image,
  Boxes,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  Map,
  MessageSquare,
  Palette,
  Server,
  Settings2,
  Table,
  Table2,
  Terminal,
  Wind,
};

export const TOOLS = APP_ROUTES.filter((route) => route.directory).map((route) => ({
  ...route,
  to: route.path,
  icon: ICONS[route.iconKey],
}));
