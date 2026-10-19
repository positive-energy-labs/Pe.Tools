# Snowdon Ducts Pod

Guidance for an agent working inside this Pod.

- Identity is the manifest id `snowdon-ducts`; the folder name is an address only. Packaged keys: `script:@snowdon-ducts/src/Census.cs`, `page:@snowdon-ducts/pages/tour`, `skill:@snowdon-ducts/skills/duct-loss`, `member:@snowdon-ducts/settings/checks.json`.
- `Census` and `InspectRun` are read-only. `CoefficientExperiment` mutates (it writes duct Comments): run it only on a disposable copy of the sample, and only after the person approves.
- Read the model before claiming anything. Element ids differ per open lifetime; discover them, never hard-code them, and revalidate before acting.
- State under `pages/tour/.state/` is user data created at run time. It is not part of the shipped Pod. Binding authority is host-owned and never travels.
- To derive your own Pod, copy it under a new manifest id; do not edit the shipped one in place.
