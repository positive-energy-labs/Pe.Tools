# Running Todo List

Generally I'm working towards a future with 3 things:

- really strong AI entrypoints into Revit
- super portable revit entities (families, schedules, more?) that can be shared between revit documents and versions, etc. 
  - figure out merge story for this
- stable multitenant (tenants being revit.exe's) Pe.Host that is the arbiter between Revit, local files, a local server/sandox env, and the frontend/AI
 
## Family Foundry
- flesh out lookup tables? 
- add support for clearance box generation
- codify an AI workflow for creating the files

## Random
- Get dual purpose perf/proof benchmarks working and good entry point
- Move lanchpad engine into here at wire up to Host
- move all ps1 scripts into a shared folder (./tools/ ??) and/or C# scripts instead
- checkup on rdbe
- Fix the family foundry lanuage in our documentation and normalize all the internal code on those semantic lines
- make the pe.ui palette wider and more Raycast-like, maybe change how the preview panels are shown to reduce lag
- maybe rethink how the palettes delineate between list item types (ie maybe master fmaily, family type, family instance, view, schedule, and sheet palette?)
- pull out the polyfill and bcl stuff into a shared package and find better global way to apply
