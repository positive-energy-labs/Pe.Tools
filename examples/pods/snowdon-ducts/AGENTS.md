# Snowdon Ducts Pod

Notes for a person reading this folder. An agent learns this Pod from `skills/duct-loss/SKILL.md`, the only guidance here that reaches it.

- Identity is the manifest id `snowdon-ducts`; the folder name is an address only. The skill lists the keys.
- `Census` and `InspectRun` are read-only. `CoefficientExperiment` mutates (it writes duct Comments): run it only on a disposable copy of the sample, and only after the person approves.
- Read the model before claiming anything. Element ids differ per open lifetime; discover them, never hard-code them, and revalidate before acting.
- Nothing made at run time is in this folder. The Page's event log, its binding and every run's output are this machine's state, kept by the host, and none of them travel with the Pod.
- To derive your own Pod, copy it under a new manifest id; do not edit the shipped one in place.
