using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Snapshots;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilySnapshotProjectionTests {
    [Test]
    public void ProjectProfiles_empty_allowed_preserves_definition_only_family_and_cache_classified_shared_parameters() {
        var snapshot = new FamilySnapshot {
            FamilyName = "SeedFamily",
            Parameters = new CapturedCollection<ParameterSnapshot> {
                Data = [
                    new ParameterSnapshot {
                        Name = "Width",
                        IsInstance = false,
                        PropertiesGroup = GroupTypeId.Geometry,
                        DataType = SpecTypeId.Length,
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                            ["Default"] = null
                        }
                    },
                    new ParameterSnapshot {
                        Name = "SharedWidth",
                        IsInstance = false,
                        SharedGuid = Guid.NewGuid(),
                        PropertiesGroup = GroupTypeId.Geometry,
                        DataType = SpecTypeId.Length,
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                            ["Default"] = null
                        }
                    }
                ]
            }
        };

        var sharedParameterNames = new HashSet<string>(StringComparer.Ordinal) {
            "SharedWidth"
        };
        var projection = FamilySnapshotProfileProjector.ProjectProfiles(
            snapshot,
            "__CURRENT_FAMILY__",
            name => sharedParameterNames.Contains(name));

        Assert.Multiple(() => {
            Assert.That(projection.EmptyAllowedProfile.AddFamilyParams.Parameters.Select(parameter => parameter.Name), Does.Contain("Width"));
            Assert.That(projection.EmptyAllowedProfile.FilterApsParams.IncludeNames.Equaling, Does.Contain("SharedWidth"));
            Assert.That(projection.EmptyAllowedProfile.AddFamilyParams.Parameters.Select(parameter => parameter.Name), Does.Not.Contain("SharedWidth"));
            Assert.That(projection.DenseProfile.AddFamilyParams.Parameters.Select(parameter => parameter.Name), Does.Not.Contain("Width"));
            Assert.That(projection.DenseProfile.FilterApsParams.IncludeNames.Equaling, Does.Not.Contain("SharedWidth"));
            Assert.That(projection.EmptyAllowedProfile.FilterFamilies.IncludeNames.Equaling, Does.Contain("__CURRENT_FAMILY__"));
        });
    }

    [Test]
    public void ProjectProfiles_keeps_value_assignments_in_both_variants() {
        var snapshot = new FamilySnapshot {
            FamilyName = "SeedFamily",
            Parameters = new CapturedCollection<ParameterSnapshot> {
                Data = [
                    new ParameterSnapshot {
                        Name = "Width",
                        IsInstance = false,
                        PropertiesGroup = GroupTypeId.Geometry,
                        DataType = SpecTypeId.Length,
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                            ["Default"] = "2' - 0\""
                        }
                    },
                    new ParameterSnapshot {
                        Name = "CalcWidth",
                        IsInstance = false,
                        PropertiesGroup = GroupTypeId.Geometry,
                        DataType = SpecTypeId.Length,
                        Formula = "Width / 2",
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                            ["Default"] = "1' - 0\""
                        }
                    }
                ]
            }
        };

        var projection = FamilySnapshotProfileProjector.ProjectProfiles(snapshot, "__CURRENT_FAMILY__");

        Assert.Multiple(() => {
            Assert.That(
                projection.DenseProfile.SetKnownParams.GlobalAssignments.Select(assignment => assignment.Parameter),
                Does.Contain("Width"));
            Assert.That(
                projection.EmptyAllowedProfile.SetKnownParams.GlobalAssignments.Select(assignment => assignment.Parameter),
                Does.Contain("Width"));
            Assert.That(
                projection.EmptyAllowedProfile.SetKnownParams.GlobalAssignments.Select(assignment => assignment.Parameter),
                Does.Contain("CalcWidth"));
            Assert.That(
                projection.DenseProfile.SetKnownParams.GlobalAssignments.Select(assignment => assignment.Parameter),
                Does.Contain("CalcWidth"));
        });
    }
}
