# Family Model showcase

Read the sibling JSON top to bottom:

1. `familyParameters` and `types` are the engineer-visible knobs. Uniform defaults live once; only exceptions live
   under a type. `Core Height` demonstrates a Revit formula and is therefore never overridden per type.
2. `planes` publishes three parametric elevations. Their slugs are stable references; labels are optional display text.
3. `frames` locate MEP Connectors by intersecting one host face with two planes. `normal` and `up` make the same frame
   understandable to Revit, an agent, and a future Three.js preview. The supporting plane owns parametric motion;
   `normal` owns Connector orientation.
4. `solids` exercise solid/void prisms and cylinders. All use the fixed family frame in this first proven slice.
5. `connectors` use engineer terms and own their visual stubs. The example covers round/rectangular duct, round pipe,
   electrical, and both inward/outward stub conventions.
6. `roomCalculationPoint` opts into the fixed PE one-foot, host-derived convention. There is intentionally no offset or
   direction knob.

Not represented yet: material/visibility bindings, rotated frames, nested dependencies, arrays, or symbolic graphics.
They are added only with the real GRD/plumbing proofs that need them.
