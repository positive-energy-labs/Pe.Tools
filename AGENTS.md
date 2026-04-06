---
alwaysApply: true
---

# Agent Standards (MUST READ)

This document is a living document, and should be updated as project standards
evolve. Our goal with this codebase is to improve the workflows of Engineering
Designers at MEP firms. These are the guiding principles of writing
maintainable, consistent, and predictable code for this purpose:

- _fail fast, fail loudly, fail early_
- _make composable systems_
- _type-safety at all costs_
- _linear execution flow, easy debugability_
- _wrap dangerous/finicky Revit API methods and classes_

In service of helping engineers we also want to write fast while maintaining
quality. With the availability of AI writing one-off code and performing
refactors is trivial. To suppor this behavior, the following codebase-management
best practices should be followed:

- _make or update.cursor rules, skills, plans_
- _update `/docs` folder when things are out of sync_
- _architect libraries for easy logging and debugging_
- _make methods specifcally for logging debug info_
- _architect and make methods for testing (e.g. an easily testable method would
  have a simpler api and few to no deps)_

## Sandbox: Testing & POC'ing & Exploring

The easiest way to test is by writing test scripts into
C:\Users\kaitp\OneDrive\Documents\ArchSmarter\Launchpad VS
Code\LaunchpadScripts. This is a sandbox env that allows us to run arbitrary
code, see C:\Users\kaitp\OneDrive\Documents\ArchSmarter\Launchpad VS
Code\.cursor\rules\launchpad-development.mdc for reference on usage.

Usually when you want to test something in this project, you have to make a
whole new IExternalCommand, this sucks. The sandbox env allows us to not pollute
our main project codebase with test code if for example you want to

- compare the performance of different approaches to a problem
- use reflection to print all members of a class or enum
- POC/MVP a core library method
- verify/debug that a Revit API method behaves as expected
- or anything adjacent to this

In the event that a test needs deep access to Pe.App internals, and Launchpad is not working, resort to writing a "Task" for the Task Palette. avoid this path though because it pollutes our repo.



## Environment

Cursor is the primary IDE, but due to it's inability to run proper
debug-and-attach sessions, Rider is also used. In order to enable Hot Reloading,
built dlls and .addin files are copied to
`\AppData\Roaming\Autodesk\Revit\Addins\{RevitVersion}\Pe.App`, which is _one_
of Revit's search paths for addins.

Due to how debug-and-attach works, rebuilding runtime projects amid a debug
session can break hot reload or leave Revit running stale code. Therefore do
not build anything unless otherwise asked. When the user does ask for
Revit-backed testing, the safe default is to build the relevant `.Tests`
project/configuration and run focused tests against that lane.

If the user says they restarted Revit from Rider by launching the normal
`Pe.App` debug configuration, treat the deployed addin lane as fresh by
default. Do not keep arguing from stale-assembly assumptions unless source and
runtime behavior concretely diverge again.

### Live debug / hot reload guidance

- Hot reload concerns must not change the intended scope of the code fix. Apply
  the correct fix first, then communicate whether Rider/Revit likely needs hot
  reload or a restart.
- Always assume stale assemblies are possible during live Revit work.
- A `.Tests` build updates the test lane but does not redeploy
  `%APPDATA%\Autodesk\Revit\Addins\{RevitVersion}\Pe.App` while Revit is
  running.
- If the deployed addin needs to be refreshed, that must happen before Revit is
  launched or after the user restarts the Rider debug session. A live Revit
  process may lock the deployed addin directory and make `Pe.App` rebuilds fail.
- Prefer adding a new targeted log line or output artifact when validating a
  runtime fix so stale assembly issues are easier to detect.
- Do not do build-related steps that risk breaking hot reload unless the user
  explicitly asked for a build/test run.

### Family Foundry debugging ladder

When diagnosing FF failures, classify the problem before changing code:

1. semantic/compiler validation issue
2. authored profile/layout issue
3. operation-time API/logic issue
4. transaction-commit warning or failure-processing issue
5. snapshot / reverse-inference / diagnostics issue

Do not skip ahead to suppression or heuristics until the failing rung is clear.

### MEP orientation / connector concepts

- Explicitly state the assumed family orientation before authoring connector
  faces when the equipment docs are ambiguous.
- Distinguish air-path faces from service-connection faces and verify both
  against submittal/CAD views.
- For refrigeration equipment:
  - liquid line typically leaves the condenser and enters the evaporator
  - suction line typically leaves the evaporator and enters the condenser
  - condensate leaves the indoor unit only
- Prefer tests and docs that encode these patterns before introducing stronger
  abstractions in runtime code.

---

## LIVING MEMORY (update as needed to avoid common mistakes and bad assumptions)

### Do's

1. Always do your research into existing patterns/solutions before writing code.
2. Follow, but also think critically about existing code. We want consistency
   and the (mostly) ideal solution. In the age of AI, refactor effort is not a
   concern, so if you see an opportunity for improvement then improve it.
3. Minimize API surfaces. Library code should balance the tradeoffs of being
   intuitive to use and general purpose.
4. **If given permmission to build** then use commands that minimize output like
   `dotnet build -c "Debug.R25" /p:WarningLevel=0`
5. This repo currently has two separate Revit-backed test lanes:
   - `source/Pe.Revit.Tests`: `ricaun.RevitTest` on VSTest / NUnit
   Keep runner-specific commands, filters, and workflow details scoped to the
   local `AGENTS.md` in each test project.
6. For live Rider/Revit work, prefer the `.Tests` configurations such as
   `Debug.R25.Tests`. The safe loop is: launch Revit from Rider, edit code,
   build the relevant `.Tests` project, let the post-build helper attempt Rider
   hot reload, then run focused tests. Treat the `.Tests` build as test-lane
   prep, not as proof that Revit loaded fresh runtime assemblies.
7. If the user explicitly says they restarted Revit by building/running the
   normal Rider `Pe.App` debug configuration, assume the deployed runtime addin
   is fresh unless current behavior proves otherwise.
8. Revit-backed test runners may attach to an already-running Revit instance.
   If behavior does not match source, suspect stale in-process assemblies before
   assuming the code change failed.
9. Hot reload is not trustworthy after runtime member-shape changes. Treat
   these as restart-required: added/removed members, method signature changes,
   constructor changes, new or deleted fields/properties, enum shape changes,
   record shape changes, and new nested types used by runtime code.
10. Be careful with live Rider/Revit debug sessions. Rebuilding runtime projects
   such as `Pe.App`, `Pe.Revit.Extensions`, or `Pe.Revit.FamilyFoundry` can break hot
   reload or leave the running Revit session executing stale assemblies.
11. Revit-backed test runners can leave `Revit.exe` or runner processes alive
    after a timeout or interrupted run. If later builds or deploys start
    failing on file locks, clean up the lingering process before retrying.
12. When validating param-driven family geometry, constraints, or connector
    behavior, prefer assertions across multiple family types or parameter
    states. Single-state checks can miss broken associations.
13. Exceptions should generally be avoided, prefer the `Result<TValue>` or
    `Try...` patterns, particularly if it's part of the public API surface
    and/or may be exposed to users. using the `Result<TValue` type allows us
    to _return_ errors rather than throw, which is better for perf. For both DX
    posterity, record common footguns/suggestions in error messages, for
    example: special transaction needs for RVT API methods, a method (eg.
    `FamilyManager.SetFormula`) throw unhelpful error messages, etc.
14. If a runtime fix appears not to take effect, verify the new debug log line
    or output artifact before concluding the logic is wrong. Common failure
    modes are: the old addin is still loaded in Revit, the hot reload patch did
    not apply, or only the test assembly was rebuilt.
15. Reduce nesting in written code and stacktraces. Use method extraction or
   condition inversion to avoid nesting in written code. Prefer sequential
   execution flow with early `return`/`break`/`continue`/`throw` over nesting.
16. Type-safety do's: label/handle nullables correctly, use generics, use
   `nameof()`, us ``is` and pattern matching,
17. Use LINQ and Fluent APIs when possible.
18. Use extension methods to get commonly used finicky code out of sight.
19. Research the breath of a problem and attempt to prove it before trying to
    solve it.
20. Use Serilogs Log.<Level> rather than Console.WriteLine or Debug.WriteLine.
21. Weigh the addition of new code against the cost of maintenance and DX.
22. Apply project standards to all code. If existing code doesn't follow the
    standards, refactor it to do so. Pay close attention to nullability and
    type-safety.
23. Centralize comments into blocks rather than sprinkling them throughout.

### Don'ts 👎👎👎

1. Don't write markdown summaries unless asked!
2. Don't nest `for` loops or `if` statements more than 4 times in a single
   method.
3. Don't (or mostly avoid) using reflection, `!`, `object` or `dynamic` type, or
   cast down
4. Don't rebuild the project without asking first. _The user will often be
   inside of a Rider debug session attached to Revit, rebuilding breaks
   debugging assembly references_, forcing them to restart.
5. Don't support backward compatibility after a refactor. If you are tempted to
   add an `[Obsolete]` attribute, delete the method and update consumers. We
   want the enforce ONE way to do something. If a new way to is better, refactor
   the old to use the new.
