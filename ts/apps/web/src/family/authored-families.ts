/** The four authored family fixtures. DATA ONLY — `createFixtureFamilyStore` is deleted (fold 4);
 *  `family/manifest.ts` turns these into `manifest.seeds`. */
import box from "@family-fixtures/a-box.json?raw";
import grd from "@family-fixtures/b-grd.json?raw";
import bath from "@family-fixtures/c-bath-shower.json?raw";
import refline from "@family-fixtures/d-bath-shower-refline.json?raw";

export const familyFixtures = { box, grd, bath, refline };
export type AuthoredFamilyName = keyof typeof familyFixtures;
