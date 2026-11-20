import { sheetCells } from "@pe/agent-contracts/product";
import { sheetSlotData } from "@pe/agent-contracts/slots";
import type { RouteWorkspace } from "@pe/runtime";
import { product, ROOM_FIELDS } from "@pe/rooms-contract/product";

const cells = sheetCells(product);
const sheet = sheetSlotData({
  draft: true,
  bindings: Object.fromEntries(
    ROOM_FIELDS.map((name) => [name, { ...cells[name], per: "subject" as const }]),
  ),
});
/**
 * The Rooms sheet slot as route admission would hand it to the host. These tests register Work
 * without admitting the web route, so the slot is built from the same product cells the route uses.
 */
export const withRoomsSheet = (workspace: RouteWorkspace) =>
  Object.assign(workspace, { sheet: (route: string) => (route === "rooms" ? sheet : undefined) });
