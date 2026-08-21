# Pe.Shared.Tests

## Scope

Owns ordinary non-Revit tests for shared contracts, host boundaries, APS boundaries, product layout, storage runtime, and automation DTOs.

## Purpose

`Pe.Shared.Tests` keeps year-neutral and out-of-proc package behavior out of the expensive Revit-backed harness. It must not use `ricaun.RevitTest`, `UIApplication`, live `Document`, Revit transactions, or the attached or fresh proof targets.

## Validation

Use ordinary compile and deterministic lanes only:

```powershell
dotnet tool run pe-revit -- test deterministic --project source/Pe.Shared.Tests/Pe.Shared.Tests.csproj
```

This is deterministic proof with contact none. A passing run proves ordinary package behavior only; it does not prove loaded Revit runtime freshness.

## Living Memory

- Keep tests only when they protect package-level capability or durable public contracts.
- Delete or quarantine brittle constant/schema/path pinning unless it protects a user-facing authored file, storage contract, host operation contract, APS boundary, product layout, or automation input/output contract.
- Do not add Revit API package references here. If a no-document test needs Revit-runtime target frameworks, keep it in `Pe.Revit.Tests/LibraryBehavior/NoDocumentRuntime/` until a better package seam exists.
