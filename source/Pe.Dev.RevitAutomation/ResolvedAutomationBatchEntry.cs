using Pe.Shared.RevitVersions;

namespace Pe.Dev.RevitAutomation;

internal sealed record ResolvedAutomationBatchEntry<TEntry, TOptions>(
    TEntry Entry,
    TOptions Options,
    RevitVersionSpec Spec,
    ResolvedAutomationShellIds ShellIds
);
