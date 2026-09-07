# Wave 21 family selector repair

## Failure

`Public_converter_selects_name_patterns_exclusions_and_native_category_identity` expected three loaded mechanical-equipment families and received none. Wave 21 loaded each new unsaved family document directly. Revit derives the loaded family name from that document's generated title, such as `Family60`, rather than from the test's `OwnerFamily.Name` assignment. The authored name filters therefore rejected every loaded family before category or placed-state filtering.

## Repair

The test now saves each disposable family as `<intended name>.rfa` and loads that file through `RevitFamilyFixtureHarness.LoadFamilyIntoProject`. It verifies the returned native `Family.Name` and `FamilyCategory.Id`. It also verifies that the project contains no `FamilyInstance`, so `IncludeUnusedFamilies=true` exercises unplaced loaded families.

`FamilyModelBuild.FamiliesMatching` is unchanged. Its existing flow applies exact category identity, include-name union, exclude-name union, and the optional placed-only filter to loaded editable families.

## Validation

- `dotnet build source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests -nologo`: exit 0, 0 errors, 130 existing warnings.
- Native rerun: open. The proof owner must rerun only `Public_converter_selects_name_patterns_exclusions_and_native_category_identity` on the integrated bytes.

