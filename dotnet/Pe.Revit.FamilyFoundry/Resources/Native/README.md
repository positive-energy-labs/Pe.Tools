# Native Family Primitives

`2025/puck.rfa` is the exact PE rotatable plumbing-connector puck extracted from
`PE WC-Urinal-Bidet.rfa`. It is a compiler-owned implementation primitive, not an authored
Family Model dependency.

The native file is necessary because Revit creates the extrusion's driven work plane through
the Family Editor's reference-line plane picker, but exposes no corresponding public API:
`SketchPlane.Create` rejects the reference line, its computed curve reference, and both endpoint
references as non-planar. Do not replace this with a sweep, hidden metadata, UI automation, or a
generic native-family path in the public model.

Native files are target-year resources. Add another year only from that Revit year; never make an
older build consume a newer RFA.
