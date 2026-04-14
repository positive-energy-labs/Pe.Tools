using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.Serialization;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyParamProfileAdapterTests {
    [Test]
    public void ProjectSnapshotsToProfile_includes_definition_only_parameters_when_requested() {
        var snapshots = new[] {
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
                Name = "PE_G___TagInstance",
                IsInstance = true,
                PropertiesGroup = GroupTypeId.IdentityData,
                DataType = SpecTypeId.String.Text,
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                    ["Default"] = "ST-#"
                }
            }
        };

        var export = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(
            snapshots,
            new FamilyParamProfileExportOptions {
                IncludeDefinitionOnlyParameters = true
            });

        Assert.Multiple(() => {
            Assert.That(export.AddFamilyParams.Enabled, Is.True);
            Assert.That(export.AddFamilyParams.Parameters.Select(parameter => parameter.Name), Does.Contain("Width"));
            Assert.That(
                export.SetKnownParams.GlobalAssignments.Select(assignment => assignment.Parameter),
                Does.Contain("PE_G___TagInstance"));
        });
    }

    [Test]
    public void ProjectSnapshotsToProfile_preserves_uniform_zero_values_as_global_assignments() {
        var snapshots = new[] {
            new ParameterSnapshot {
                Name = "Offset",
                IsInstance = false,
                PropertiesGroup = GroupTypeId.Geometry,
                DataType = SpecTypeId.Length,
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                    ["Type A"] = "0\"",
                    ["Type B"] = "0\""
                }
            }
        };

        var export = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(
            snapshots,
            new FamilyParamProfileExportOptions {
                IncludeDefinitionOnlyParameters = true
            });

        Assert.That(
            export.SetKnownParams.GlobalAssignments.Single(assignment => assignment.Parameter == "Offset").Value,
            Is.EqualTo("0\""));
    }

    [Test]
    public void ProjectSnapshotsToProfile_omits_definition_only_parameters_by_default() {
        var snapshots = new[] {
            new ParameterSnapshot {
                Name = "Width",
                IsInstance = false,
                PropertiesGroup = GroupTypeId.Geometry,
                DataType = SpecTypeId.Length,
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                    ["Default"] = null
                }
            }
        };

        var export = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(snapshots);

        Assert.Multiple(() => {
            Assert.That(export.AddFamilyParams.Enabled, Is.False);
            Assert.That(export.AddFamilyParams.Parameters, Is.Empty);
            Assert.That(export.SetKnownParams.Enabled, Is.False);
        });
    }
}
