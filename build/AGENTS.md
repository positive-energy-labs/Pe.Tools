# build

## Scope

Owns the repo-level compile, pack, and publish automation.

## Purpose

`./build` is the preferred compile-verification path for this repo. It is the CI-aligned surface for compiling supported Revit configurations without teaching agents to build `Pe.App` directly.

## Critical Entry Points

- `Program.cs` - command/option registration for compile, pack, and publish flows.
- `Modules/CompileProjectModule.cs` - compile execution.
- `Modules/ResolveConfigurationsModule.cs` - default all-years vs explicit `--configuration` selection.

## Validation

- Compile all supported release years: `dotnet run -c Release`
- Compile one selected configuration: `dotnet run -c Debug -- --configuration Debug.R25`
- This executable is for compile verification, not proof of live RRD runtime freshness.

## Living Memory

- Default compile behavior is all supported `Release.R*` solution configurations.
- `--configuration <BuildType>` narrows compile verification to one selected solution configuration such as `Debug.R25` or `Release.R25`.
- Do not teach direct `Pe.App` builds as the primary compile-verification path when `./build` can answer the question.
