using Pe.Revit.FamilyFoundry.Serialization;
using Pe.Shared.RevitData;

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
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = null }
            },
            new ParameterSnapshot {
                Definition = new ParameterDefinitionDescriptor(
                    new ParameterIdentity(
                        "shared-guid:11111111-2222-3333-4444-555555555555",
                        ParameterIdentityKind.SharedGuid,
                        "SharedTagInstance",
                        null,
                        "11111111-2222-3333-4444-555555555555",
                        null),
                    true,
                    SpecTypeId.String.Text.TypeId,
                    null,
                    GroupTypeId.IdentityData.TypeId,
                    null),
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = "ST-#" }
            }
        };

        var export = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(
            snapshots,
            new FamilyParamProfileExportOptions { IncludeDefinitionOnlyParameters = true });

        Assert.Multiple(() => {
            Assert.That(export.AddFamilyParams.Enabled, Is.True);
            Assert.That(export.AddFamilyParams.Parameters.Select(parameter => parameter.Name), Does.Contain("Width"));
            Assert.That(export.AddFamilyParams.Parameters.Select(parameter => parameter.Name),
                Does.Not.Contain("SharedTagInstance"));
            Assert.That(
                export.SetKnownParams.GlobalAssignments.Select(assignment => assignment.Parameter),
                Does.Contain("SharedTagInstance"));
        });
    }

    [Test]
    public void ProjectSnapshotsToProfile_treats_prefix_named_parameters_without_shared_identity_as_local() {
        var snapshots = new[] {
            new ParameterSnapshot {
                Name = "PE_LocalOnly",
                IsInstance = true,
                PropertiesGroup = GroupTypeId.IdentityData,
                DataType = SpecTypeId.String.Text,
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = "local" }
            }
        };

        var export = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(
            snapshots,
            new FamilyParamProfileExportOptions { IncludeDefinitionOnlyParameters = true });

        Assert.That(export.AddFamilyParams.Parameters.Select(parameter => parameter.Name),
            Does.Contain("PE_LocalOnly"));
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
                    ["Type A"] = "0\"", ["Type B"] = "0\""
                }
            }
        };

        var export = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(
            snapshots,
            new FamilyParamProfileExportOptions { IncludeDefinitionOnlyParameters = true });

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
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = null }
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