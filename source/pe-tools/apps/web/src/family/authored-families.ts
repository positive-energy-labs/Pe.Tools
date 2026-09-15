/** The four authored family fixtures. DATA ONLY — `createFixtureFamilyStore` is deleted (fold 4);
 *  `family/manifest.ts` turns these into `manifest.seeds`. */
import box from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/a-box.family.json?raw";
import grd from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/b-grd.family.json?raw";
import bath from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/c-bath-shower.family.json?raw";
import refline from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/d-bath-shower-refline.family.json?raw";

export const familyFixtures = { box, grd, bath, refline };
export type AuthoredFamilyName = keyof typeof familyFixtures;
