# Reference-plane strength roundtrip

Base: `c3e4a61`. Native `ELEM_REFERENCE_NAME` uses integer `12` for `NotAReference`. `MakeRefPlanes.Strength` already writes `12`, but capture's inverse mapping returned null for that value. An explicitly authored `isReference: NotAReference` therefore became an omitted field and forced every driven GRD opening plane to recreate.

Capture now maps `12` to `RefStrength.NotAReference`. The reconciler separately removes captured `isReference` from comparison only when the desired plane omitted the field, preserving omission as unconstrained intent rather than silently converting it to an explicit default. Explicit `NotAReference` continues through normal equality and will detect a different native strength.

The existing GRD pre-array probe retains the fixture's explicit strengths and asserts both captured opening planes are `NotAReference`; `FamilyModelBuild.Build` retains its full convergence check. Exact compile `dotnet build source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests -nologo` exited 0 with 130 warnings and 0 errors. No native run or fixture edit occurred.
