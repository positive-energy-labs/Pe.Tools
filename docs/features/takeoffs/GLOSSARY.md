# Takeoffs glossary

Terms used to judge and disposition Takeoff room geometry.

## Language

**Stairstep run**:
A boundary that approximates one intended rail with consecutive handle-scale edges and repeated turns. The current audit calls this `MicroStepRun`.
_Avoid_: Micro-jog, staircase when referring to an architectural stair.

**Micro-jog**:
A single short perpendicular detour between two boundary edges that otherwise continue on one rail. `DeJog` repairs this shape.
_Avoid_: Stairstep run, micro-step run.

**Candidate geometry**:
A reliably drawn room loop kept in the UI for review regardless of its current disposition. It does not imply Revit persistence.
_Avoid_: Residue when the geometry still represents a possible room.

**Void**:
A positively evidenced part of a zone that is not a room candidate.
_Avoid_: Unknown area, rejected room, low-confidence room.
