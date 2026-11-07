import { sessionAdminAddress } from "./g4-splits.ts";
import type { RouteDeclaration } from "../route-field.ts";
import { fansAddress } from "./fans.ts";
import { ductsAddress } from "./ducts.ts";
import { familiesAddress } from "./families.ts";
import { familyAddress } from "./family.ts";
import { schedulesAddress } from "./schedules.ts";
import { roomsAddress } from "./rooms.ts";
import { takeoffsAddress } from "./takeoffs.ts";
import { spaceAddress } from "./space.ts";
import { podsAddress } from "./pods.ts";
import { bindAddress } from "./bind.ts";
import { settingsAddress } from "./settings.ts";
import { opsAddress } from "./ops.ts";
import { peaAddress } from "./pea.ts";
import { homeAddress } from "./home.ts";
import { ductLossAddress } from "./duct-loss.ts";
import { capturesAddress } from "./captures.ts";

export { DUCTS_LAYERS } from "./picture.ts";
export { ROOMS_LAYERS } from "./rooms.ts";
export { SPACE_LAYERS, spaceElementKey } from "./space.ts";
export { FAMILIES_DEFAULT_QUERY } from "./families.ts";
export { SETTINGS_SECTIONS } from "./settings.ts";
export { GALVANIZED_STEEL_ROUGHNESS } from "./duct-loss.ts";

/** Every route's address, by route key; each route declares its own in `routes/<route>.ts`. */
export const routeAddresses = {
  "session-admin": sessionAdminAddress,
  ducts: ductsAddress,
  fans: fansAddress,
  families: familiesAddress,
  family: familyAddress,
  schedules: schedulesAddress,
  rooms: roomsAddress,
  takeoffs: takeoffsAddress,
  space: spaceAddress,
  pods: podsAddress,
  bind: bindAddress,
  settings: settingsAddress,
  ops: opsAddress,
  pea: peaAddress,
  home: homeAddress,
  "duct-loss": ductLossAddress,
  captures: capturesAddress,
} satisfies Record<string, RouteDeclaration>;
