using Pe.Revit.DocumentData.Parameters;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParameterReferenceResolverTests {
    [Test]
    public void Resolves_identity_references_for_shared_guid_and_name_matching() {
        var sharedIdentity = ParameterIdentityEngine.FromRaw(
            "Equipment Tag",
            null,
            "11111111-2222-3333-4444-555555555555",
            null);
        var localIdentity = ParameterIdentityEngine.FromRaw("Local Only", null, null, null);

        var references = ParameterReferenceResolver.Resolve([
            ParameterReference.FromIdentity(sharedIdentity),
            ParameterReference.FromName("Local Only")
        ]);

        Assert.Multiple(() => {
            Assert.That(ParameterReferenceResolver.Matches(sharedIdentity, references), Is.True);
            Assert.That(ParameterReferenceResolver.Matches(localIdentity, references), Is.True);
            Assert.That(
                ParameterReferenceResolver.Matches(ParameterIdentityEngine.FromRaw("Other", null, null, null), references),
                Is.False);
        });
    }

    [Test]
    public void Resolves_requested_parameter_query_references_without_name_list_contract() {
        var query = new RequestedParameterQuery {
            Parameters = [
                ParameterReference.FromName("Mark"),
                ParameterReference.FromIdentity(new ParameterIdentity(
                    "builtin:-1001203",
                    ParameterIdentityKind.BuiltInParameter,
                    "Mark",
                    -1001203,
                    null,
                    null))
            ]
        };

        var references = ParameterReferenceResolver.Resolve(query.Parameters);

        Assert.Multiple(() => {
            Assert.That(references, Has.Count.EqualTo(2));
            Assert.That(references.Any(reference => reference.Identity.Kind == ParameterIdentityKind.NameFallback), Is.True);
            Assert.That(references.Any(reference => reference.Identity.Kind == ParameterIdentityKind.BuiltInParameter), Is.True);
        });
    }

    [Test]
    public void Resolves_parameter_element_and_built_in_identity_references_without_name_fallback_authority() {
        var builtInIdentity = ParameterIdentityEngine.FromCanonical(new ParameterIdentity(
            "builtin:-1001203",
            ParameterIdentityKind.BuiltInParameter,
            "Mark",
            -1001203,
            null,
            null));
        var parameterElementIdentity = ParameterIdentityEngine.FromCanonical(new ParameterIdentity(
            "parameter-element:123456",
            ParameterIdentityKind.ParameterElement,
            "Custom Tag",
            null,
            null,
            123456));

        var references = ParameterReferenceResolver.Resolve([
            ParameterReference.FromIdentity(builtInIdentity),
            ParameterReference.FromIdentity(parameterElementIdentity)
        ]);

        Assert.Multiple(() => {
            Assert.That(ParameterReferenceResolver.Matches(builtInIdentity, references), Is.True);
            Assert.That(ParameterReferenceResolver.Matches(parameterElementIdentity, references), Is.True);
            Assert.That(
                ParameterReferenceResolver.Matches(ParameterIdentityEngine.FromRaw("Mark", null, null, null), references),
                Is.False);
        });
    }
}
