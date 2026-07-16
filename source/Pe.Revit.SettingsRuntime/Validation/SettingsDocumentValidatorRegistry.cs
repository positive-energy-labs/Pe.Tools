using System.Collections.Concurrent;

namespace Pe.Revit.SettingsRuntime.Validation;

public sealed record SettingsDocumentValidationContext(
    string RawContent,
    string ComposedContent
);

public sealed record SettingsDocumentValidationIssue(
    string Path,
    string Code,
    string Severity,
    string Message,
    string? Suggestion = null
);

public sealed class SettingsDocumentValidatorRegistry {
    private readonly ConcurrentDictionary<Type, Func<SettingsDocumentValidationContext,
        IReadOnlyList<SettingsDocumentValidationIssue>>> _validators = new();

    public static SettingsDocumentValidatorRegistry Shared { get; } = new();

    public void Register<TSettings>(
        Func<SettingsDocumentValidationContext, IReadOnlyList<SettingsDocumentValidationIssue>> validator
    ) where TSettings : class {
        if (validator == null)
            throw new ArgumentNullException(nameof(validator));

        if (!this._validators.TryAdd(typeof(TSettings), validator))
            throw new InvalidOperationException(
                $"A settings document validator is already registered for '{typeof(TSettings).FullName}'.");
    }

    public bool TryValidate(
        Type settingsType,
        SettingsDocumentValidationContext context,
        out IReadOnlyList<SettingsDocumentValidationIssue> issues
    ) {
        if (this._validators.TryGetValue(settingsType, out var validator)) {
            issues = validator(context);
            return true;
        }

        issues = [];
        return false;
    }
}
