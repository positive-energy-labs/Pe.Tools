import type { TakeoffResidueShape } from "#/rhvac/types";

import { type MockRoom, type MockZone } from "./mock";

export interface GeoRoom extends MockRoom {
  outer: [number, number][] | null;
  holes: [number, number][][];
}

export interface GeoZone extends Omit<MockZone, "rooms"> {
  rooms: GeoRoom[];
  residues: TakeoffResidueShape[];
}
