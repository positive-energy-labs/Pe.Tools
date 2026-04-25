namespace Pe.Shared.RevitVersions;

public sealed record RevitVersionSpec(
    int Year,
    string ConfigurationSuffix,
    string DesignAutomationEngine,
    string DesignAutomationPackageVersion,
    string TargetFramework,
    bool SupportsDesignAutomation
);
