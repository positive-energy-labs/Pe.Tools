using Pe.Host.Contracts;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Allows a provider to describe how clients should resolve its field options.
/// </summary>
public interface IFieldOptionsClientHintProvider {
    FieldOptionsResolverKind Resolver { get; }
    FieldOptionsDatasetKind? Dataset { get; }
}
