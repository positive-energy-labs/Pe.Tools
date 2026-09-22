/** The four authored family fixtures. DATA ONLY — `createFixtureFamilyStore` is deleted (fold 4);
 *  `family/manifest.ts` turns these into `manifest.seeds`. */
import box from "../../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/a-box.json?raw";
import grd from "../../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/b-grd.json?raw";
import bath from "../../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/c-bath-shower.json?raw";
import refline from "../../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/d-bath-shower-refline.json?raw";

export const familyFixtures = { box, grd, bath, refline };
export type AuthoredFamilyName = keyof typeof familyFixtures;
