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

The easiest way to test is to write a "Task" for the Task Palette. This lets us
run oneoff code to test and verify soltuions before fully implementing. Common
use cases are:

- compare the performance of different approaches to a problem
- use reflection to print all members of a class or enum
- POC/MVP a core library method
- verify/debug that a Revit API method behaves as expected

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
   - `source/Pe.Tools.Tests`: TUnit on Microsoft.Testing.Platform
   - `source/Pe.Tools.RevitTest.Tests`: `ricaun.RevitTest` on VSTest / NUnit
   Keep runner-specific commands, filters, and workflow details scoped to the
   local `AGENTS.md` in each test project.
6. For live Rider/Revit work, prefer the `.Tests` configurations such as
   `Debug.R25.Tests`. The safe loop is: launch Revit from Rider, edit code,
   build the relevant `.Tests` project, let the post-build helper attempt Rider
   hot reload, then run focused tests. Treat the `.Tests` build as test-lane
   prep, not as proof that Revit loaded fresh runtime assemblies.
7. Revit-backed test runners may attach to an already-running Revit instance.
   If behavior does not match source, suspect stale in-process assemblies before
   assuming the code change failed.
8. Hot reload is not trustworthy after runtime member-shape changes. Treat
   these as restart-required: added/removed members, method signature changes,
   constructor changes, new or deleted fields/properties, enum shape changes,
   record shape changes, and new nested types used by runtime code.
9. Be careful with live Rider/Revit debug sessions. Rebuilding runtime projects
   such as `Pe.App`, `Pe.Extensions`, or `Pe.FamilyFoundry` can break hot
   reload or leave the running Revit session executing stale assemblies.
10. Revit-backed test runners can leave `Revit.exe` or runner processes alive
    after a timeout or interrupted run. If later builds or deploys start
    failing on file locks, clean up the lingering process before retrying.
11. When validating param-driven family geometry, constraints, or connector
    behavior, prefer assertions across multiple family types or parameter
    states. Single-state checks can miss broken associations.
12. Exceptions should generally be avoided, prefer the `Result<TValue>` or
    `Try...` patterns, particularly if it's part of the public API surface
    and/or may be exposed to users. using the `Result<TValue` type allows us
    to _return_ errors rather than throw, which is better for perf. For both DX
    posterity, record common footguns/suggestions in error messages, for
    example: special transaction needs for RVT API methods, a method (eg.
    `FamilyManager.SetFormula`) throw unhelpful error messages, etc.
13. If a runtime fix appears not to take effect, verify the new debug log line
    or output artifact before concluding the logic is wrong. Common failure
    modes are: the old addin is still loaded in Revit, the hot reload patch did
    not apply, or only the test assembly was rebuilt.
14. Reduce nesting in written code and stacktraces. Use method extraction or
   condition inversion to avoid nesting in written code. Prefer sequential
   execution flow with early `return`/`break`/`continue`/`throw` over nesting.
15. Type-safety do's: label/handle nullables correctly, use generics, use
   `nameof()`, us ``is` and pattern matching,
16. Use LINQ and Fluent APIs when possible.
17. Use extension methods to get commonly used finicky code out of sight.
18. Research the breath of a problem and attempt to prove it before trying to
    solve it.
19. Use Serilogs Log.<Level> rather than Console.WriteLine or Debug.WriteLine.
20. Weigh the addition of new code against the cost of maintenance and DX.
21. Apply project standards to all code. If existing code doesn't follow the
    standards, refactor it to do so. Pay close attention to nullability and
    type-safety.
22. Centralize comments into blocks rather than sprinkling them throughout.

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
