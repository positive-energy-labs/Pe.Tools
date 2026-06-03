using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilySnapshotProjectionTests {
    [Test]
    public void ProjectProfiles_empty_allowed_preserves_definition_only_family_and_identity_shared_parameters() {
        var snapshot = new FamilySnapshot {
            FamilyName = "SeedFamily",
            Parameters = new CapturedCollection<ParameterSnapshot> {
                Data = [
                    new ParameterSnapshot {
                        Name = "Width",
                        IsInstance = false,
                        PropertiesGroup = GroupTypeId.Geometry,
                        DataType = SpecTypeId.Length,
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = null }
                    },
                    new ParameterSnapshot {
                        Name = "SharedWidth",
                        IsInstance = false,
                        SharedGuid = Guid.NewGuid(),
                        PropertiesGroup = GroupTypeId.Geometry,
                        DataType = SpecTypeId.Length,
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = null }
                    }
                ]
            }
        };

        var projection = FamilySnapshotProfileProjector.ProjectProfiles(snapshot, "__CURRENT_FAMILY__");

        Assert.Multiple(() => {
            Assert.That(projection.EmptyAllowedProfile.FamilyParameters.Select(parameter => parameter.Name),
                Does.Contain("Width"));
            Assert.That(projection.EmptyAllowedProfile.SharedParameters.Select(parameter => parameter.Name),
                Does.Contain("SharedWidth"));
            Assert.That(projection.EmptyAllowedProfile.FamilyParameters.Select(parameter => parameter.Name),
                Does.Not.Contain("SharedWidth"));
            Assert.That(projection.DenseProfile.FamilyParameters.Select(parameter => parameter.Name),
                Does.Not.Contain("Width"));
            Assert.That(projection.DenseProfile.SharedParameters.Select(parameter => parameter.Name), Does.Not.Contain("SharedWidth"));
            Assert.That(projection.EmptyAllowedProfile.FilterFamilies.IncludeNames.Equaling,
                Does.Contain("__CURRENT_FAMILY__"));
        });
    }

    [Test]
    public void ProjectProfiles_treats_prefix_named_parameters_without_shared_identity_as_local_family_parameters() {
        var snapshot = new FamilySnapshot {
            FamilyName = "SeedFamily",
            Parameters = new CapturedCollection<ParameterSnapshot> {
                Data = [
                    new ParameterSnapshot {
                        Name = "PE_LocalOnly",
                        IsInstance = true,
                        PropertiesGroup = GroupTypeId.IdentityData,
                        DataType = SpecTypeId.String.Text,
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                            ["Default"] = "local"
                        }
                    }
                ]
            }
        };

        var projection = FamilySnapshotProfileProjector.ProjectProfiles(snapshot, "__CURRENT_FAMILY__");

        Assert.Multiple(() => {
            Assert.That(
                projection.DenseProfile.FamilyParameters.Select(parameter => parameter.Name),
                Does.Contain("PE_LocalOnly"));
            Assert.That(projection.DenseProfile.SharedParameters.Select(parameter => parameter.Name),
                Does.Not.Contain("PE_LocalOnly"));
            Assert.That(projection.EmptyAllowedProfile.SharedParameters.Select(parameter => parameter.Name),
                Does.Not.Contain("PE_LocalOnly"));
        });
    }

    [Test]
    public void ProjectProfiles_treats_shared_identity_without_prefix_as_shared_parameter() {
        var snapshot = new FamilySnapshot {
            FamilyName = "SeedFamily",
            Parameters = new CapturedCollection<ParameterSnapshot> {
                Data = [
                    new ParameterSnapshot {
                        Definition = new ParameterDefinitionDescriptor(
                            new ParameterIdentity(
                                "shared-guid:11111111-2222-3333-4444-555555555555",
                                ParameterIdentityKind.SharedGuid,
                                "SharedWithoutPrefix",
                                null,
                                "11111111-2222-3333-4444-555555555555",
                                null),
                            false,
                            SpecTypeId.Length.TypeId,
                            null,
                            GroupTypeId.Geometry.TypeId,
                            null),
                        ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) { ["Default"] = null }
                    }
                ]
            }
        };

        var projection = FamilySnapshotProfileProjector.ProjectProfiles(snapshot, "__CURRENT_FAMILY__");

        Assert.Multiple(() => {
            Assert.That(
                projection.EmptyAllowedProfile.SharedParameters.Select(parameter => parameter.Name),
                Does.Contain("SharedWithoutPrefix"));
            Assert.That(
                projection.EmptyAllowedProfile.FamilyParameters.Select(parameter => parameter.Name),
                Does.Not.Contain("SharedWithoutPrefix"));
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
                projection.DenseProfile.FamilyParameters.Single(parameter => parameter.Name == "Width").Value,
                Is.EqualTo("2' - 0\""));
            Assert.That(
                projection.EmptyAllowedProfile.FamilyParameters.Single(parameter => parameter.Name == "Width").Value,
                Is.EqualTo("2' - 0\""));
            Assert.That(
                projection.EmptyAllowedProfile.FamilyParameters.Single(parameter => parameter.Name == "CalcWidth").Formula,
                Is.EqualTo("Width / 2"));
            Assert.That(
                projection.DenseProfile.FamilyParameters.Single(parameter => parameter.Name == "CalcWidth").Formula,
                Is.EqualTo("Width / 2"));
        });
    }
}