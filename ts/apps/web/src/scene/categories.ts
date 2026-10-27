// Autodesk.Revit.DB.BuiltInCategory, verified against RevitAPI 2025.4.60 metadata.
export const CATEGORY_IDS = {
  walls: -2000011,
  curtainPanels: -2000170,
  curtainMullions: -2000171,
  structuralColumns: -2001330,
  structuralFraming: -2001320,
  structuralFoundations: -2001300,
  floors: -2000032,
  lightingFixtures: -2001120,
  lightingDevices: -2008087,
  // Confirmed against the cached scene's PSC1 metadata (Ducts|-2008000, Pipes|-2008044), not RevitAPI metadata.
  ducts: -2008000,
  pipes: -2008044,
} as const;
