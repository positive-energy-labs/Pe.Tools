using Pe.RevitData.Families;
using Pe.RevitData.Parameters;

namespace Pe.Tools.Tests;

public sealed class RevitParameterAuthorityResolverTests {
    [Test]
    public async Task Shared_merge_uses_family_scope_and_project_group_authority() {
        var sharedGuid = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = SharedIdentity("Flow", sharedGuid),
            CategoryName = "Mechanical Equipment",
            IsInstance = true,
            PropertiesGroup = new ForgeTypeId("group.live"),
            DataType = new ForgeTypeId("spec.live")
        };
        var family = new RevitFamilyParameterMetadata {
            Identity = SharedIdentity("Flow", sharedGuid),
            IsInstance = true,
            PropertiesGroup = new ForgeTypeId("group.family"),
            DataType = new ForgeTypeId("spec.family")
        };
        var projectBinding = new RevitProjectBindingMetadata {
            Identity = SharedIdentity("Flow", sharedGuid),
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.project"),
            DataType = new ForgeTypeId("spec.project"),
            CategoryNames = ["Mechanical Equipment"]
        };

        var resolution = RevitParameterAuthorityResolver.Resolve(observed, family, projectBinding);

        await Assert.That(resolution.HasFamilyParameter).IsTrue();
        await Assert.That(resolution.HasProjectBinding).IsTrue();
        await Assert.That(resolution.HasMergedSharedProjectBinding).IsTrue();
        await Assert.That(resolution.IsInstance).IsTrue();
        await Assert.That(resolution.PropertiesGroup.TypeId).IsEqualTo("group.project");
        await Assert.That(resolution.DataType.TypeId).IsEqualTo("spec.family");
    }

    [Test]
    public async Task Family_match_does_not_fallback_to_name_when_shared_guid_differs() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = SharedIdentity("Flow", Guid.Parse("11111111-1111-1111-1111-111111111111")),
            CategoryName = "Mechanical Equipment",
            IsInstance = true
        };
        var family = new RevitFamilyParameterMetadata {
            Identity = SharedIdentity("Flow", Guid.Parse("22222222-2222-2222-2222-222222222222")),
            IsInstance = true
        };

        var matches = RevitParameterAuthorityResolver.MatchesFamilyParameter(observed, family);

        await Assert.That(matches).IsFalse();
    }

    [Test]
    public async Task Family_match_does_not_fallback_to_name_for_parameter_element_identity() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = ParameterElementIdentity("Project Notes", 42),
            CategoryName = "Mechanical Equipment",
            IsInstance = false
        };
        var family = new RevitFamilyParameterMetadata {
            Identity = NameIdentity("Project Notes"),
            IsInstance = false
        };

        var matches = RevitParameterAuthorityResolver.MatchesFamilyParameter(observed, family);

        await Assert.That(matches).IsFalse();
    }

    [Test]
    public async Task Family_match_allows_true_name_fallback_against_family_parameter_identity() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = NameIdentity("Project Notes"),
            CategoryName = "Mechanical Equipment",
            IsInstance = false
        };
        var family = new RevitFamilyParameterMetadata {
            Identity = ParameterElementIdentity("Project Notes", 42),
            IsInstance = false
        };

        var matches = RevitParameterAuthorityResolver.MatchesFamilyParameter(observed, family);

        await Assert.That(matches).IsTrue();
    }

    [Test]
    public async Task Family_match_does_not_treat_built_in_identity_as_authored_family_authority() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = BuiltInIdentity("Comments", (int)BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS),
            CategoryName = "Mechanical Equipment",
            IsInstance = true
        };
        var family = new RevitFamilyParameterMetadata {
            Identity = NameIdentity("Comments"),
            IsInstance = true
        };

        var matches = RevitParameterAuthorityResolver.MatchesFamilyParameter(observed, family);

        await Assert.That(matches).IsFalse();
    }

    [Test]
    public async Task Family_only_non_shared_parameter_resolves_as_family_authority() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = NameIdentity("Family Notes"),
            CategoryName = "Mechanical Equipment",
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.live"),
            DataType = new ForgeTypeId("spec.live")
        };
        var family = new RevitFamilyParameterMetadata {
            Identity = NameIdentity("Family Notes"),
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.family"),
            DataType = new ForgeTypeId("spec.family")
        };

        var resolution = RevitParameterAuthorityResolver.Resolve(observed, family, null);

        await Assert.That(resolution.HasFamilyParameter).IsTrue();
        await Assert.That(resolution.HasProjectBinding).IsFalse();
        await Assert.That(resolution.IsInstance).IsFalse();
        await Assert.That(resolution.PropertiesGroup.TypeId).IsEqualTo("group.family");
        await Assert.That(resolution.DataType.TypeId).IsEqualTo("spec.family");
    }

    [Test]
    public async Task Project_binding_takes_authority_over_same_name_non_shared_observation() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = ParameterElementIdentity("Project Notes", 42),
            CategoryName = "Mechanical Equipment",
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.live"),
            DataType = new ForgeTypeId("spec.live")
        };
        var family = new RevitFamilyParameterMetadata {
            Identity = NameIdentity("Project Notes"),
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.family"),
            DataType = new ForgeTypeId("spec.family")
        };
        var projectBinding = new RevitProjectBindingMetadata {
            Identity = ParameterElementIdentity("Project Notes", 42),
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.project"),
            DataType = new ForgeTypeId("spec.project"),
            CategoryNames = ["Mechanical Equipment"]
        };

        var familyMatch = RevitParameterAuthorityResolver.MatchesFamilyParameter(observed, family);
        var projectMatch = RevitParameterAuthorityResolver.MatchesProjectOnlyBinding(observed, projectBinding);
        var resolution = RevitParameterAuthorityResolver.Resolve(observed, null, projectBinding);

        await Assert.That(familyMatch).IsFalse();
        await Assert.That(projectMatch).IsTrue();
        await Assert.That(resolution.HasFamilyParameter).IsFalse();
        await Assert.That(resolution.HasProjectBinding).IsTrue();
        await Assert.That(resolution.PropertiesGroup.TypeId).IsEqualTo("group.project");
        await Assert.That(resolution.DataType.TypeId).IsEqualTo("spec.project");
    }

    [Test]
    public async Task Project_shared_merge_ignores_binding_scope_for_guid_match() {
        var sharedGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var family = new RevitFamilyParameterMetadata {
            Identity = SharedIdentity("Pressure", sharedGuid),
            IsInstance = true
        };
        var projectBinding = new RevitProjectBindingMetadata {
            Identity = SharedIdentity("Pressure", sharedGuid),
            IsInstance = false,
            CategoryNames = ["Mechanical Equipment"]
        };

        var matches = RevitParameterAuthorityResolver.MatchesProjectSharedBinding(
            "Mechanical Equipment",
            family,
            projectBinding
        );

        await Assert.That(matches).IsTrue();
    }

    [Test]
    public async Task Project_only_binding_does_not_treat_shared_name_collision_as_a_match() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = NameIdentity("Flow"),
            CategoryName = "Mechanical Equipment",
            IsInstance = true
        };
        var projectBinding = new RevitProjectBindingMetadata {
            Identity = SharedIdentity("Flow", Guid.Parse("44444444-4444-4444-4444-444444444444")),
            IsInstance = true,
            CategoryNames = ["Mechanical Equipment"]
        };

        var matches = RevitParameterAuthorityResolver.MatchesProjectOnlyBinding(observed, projectBinding);
        var collision = RevitParameterAuthorityResolver.MatchesNameScopeCollision(observed, projectBinding);

        await Assert.That(matches).IsFalse();
        await Assert.That(collision).IsTrue();
    }

    [Test]
    public async Task Project_only_binding_uses_project_binding_authority() {
        var observed = new RevitObservedProjectParameterMetadata {
            Identity = ParameterElementIdentity("Project Notes", 42),
            CategoryName = "Mechanical Equipment",
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.live"),
            DataType = new ForgeTypeId("spec.live")
        };
        var projectBinding = new RevitProjectBindingMetadata {
            Identity = ParameterElementIdentity("Project Notes", 42),
            IsInstance = false,
            PropertiesGroup = new ForgeTypeId("group.project"),
            DataType = new ForgeTypeId("spec.project"),
            CategoryNames = ["Mechanical Equipment"]
        };

        var resolution = RevitParameterAuthorityResolver.Resolve(observed, null, projectBinding);

        await Assert.That(resolution.HasFamilyParameter).IsFalse();
        await Assert.That(resolution.HasProjectBinding).IsTrue();
        await Assert.That(resolution.IsInstance).IsFalse();
        await Assert.That(resolution.PropertiesGroup.TypeId).IsEqualTo("group.project");
        await Assert.That(resolution.DataType.TypeId).IsEqualTo("spec.project");
    }

    private static RevitParameterIdentity SharedIdentity(string name, Guid sharedGuid) =>
        new(
            $"shared:{sharedGuid:D}",
            RevitParameterIdentityKind.SharedGuid,
            name,
            null,
            sharedGuid,
            null
        );

    private static RevitParameterIdentity NameIdentity(string name) =>
        new(
            $"name:{name.ToLowerInvariant()}",
            RevitParameterIdentityKind.NameFallback,
            name,
            null,
            null,
            null
        );

    private static RevitParameterIdentity ParameterElementIdentity(string name, long parameterElementId) =>
        new(
            $"parameter-element:{parameterElementId}",
            RevitParameterIdentityKind.ParameterElement,
            name,
            null,
            null,
            parameterElementId
        );

    private static RevitParameterIdentity BuiltInIdentity(string name, int builtInParameterId) =>
        new(
            $"builtin:{builtInParameterId}",
            RevitParameterIdentityKind.BuiltInParameter,
            name,
            builtInParameterId,
            null,
            null
        );
}
