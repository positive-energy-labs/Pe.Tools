import { readFileSync } from "node:fs";
import { join } from "node:path";
import { familyFixturesDir } from "../checkout-paths.ts";

// Jiti's declaration pass cannot load Vite ?raw imports. Read the same canonical bytes.
const read = (name: string) => readFileSync(join(familyFixturesDir, `${name}.json`), "utf8");
export const familyFixtures = {
  box: read("a-box"),
  grd: read("b-grd"),
  bath: read("c-bath-shower"),
  refline: read("d-bath-shower-refline"),
};
export type AuthoredFamilyName = keyof typeof familyFixtures;
