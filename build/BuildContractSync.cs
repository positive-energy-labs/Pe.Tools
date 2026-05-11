using System.Xml.Linq;
using Pe.Shared.Product;

namespace Build;

internal static class BuildContractSync {
    public static IReadOnlyList<string> SyncAll(string repositoryRoot) {
        var matrix = BuildConfigurationFile.LoadAuthoring(repositoryRoot);
        var taxonomy = BuildTaxonomyFile.Load(repositoryRoot);
        var packagePolicies = BuildPackagePolicyFile.Load(repositoryRoot);
        var productLayout = ProductBuildLayoutProjection.CreateDefault();

        var generatedFiles = new List<string>();
        WriteIfChanged(
            Path.Combine(repositoryRoot, BuildGeneratedContractPaths.MatrixConfigurationFilePath),
            RenderMatrixConfiguration(matrix),
            generatedFiles
        );
        WriteIfChanged(
            Path.Combine(repositoryRoot, BuildGeneratedContractPaths.MatrixTargetFrameworkFilePath),
            RenderMatrixTargetFramework(matrix),
            generatedFiles
        );
        WriteIfChanged(
            Path.Combine(repositoryRoot, BuildGeneratedContractPaths.TaxonomyEvaluatorFilePath),
            RenderTaxonomyEvaluator(taxonomy),
            generatedFiles
        );
        WriteIfChanged(
            Path.Combine(repositoryRoot, BuildGeneratedContractPaths.TaxonomyValidationTargetsFilePath),
            RenderTaxonomyValidationTargets(),
            generatedFiles
        );
        WriteIfChanged(
            Path.Combine(repositoryRoot, BuildGeneratedContractPaths.PackagePolicyFilePath),
            RenderPackagePolicy(packagePolicies),
            generatedFiles
        );
        WriteIfChanged(
            Path.Combine(repositoryRoot, BuildGeneratedContractPaths.ProductLayoutFilePath),
            RenderProductLayout(productLayout),
            generatedFiles
        );

        return generatedFiles;
    }

    private static void WriteIfChanged(string path, string content, ICollection<string> generatedFiles) {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var normalizedContent = content.Replace("\r\n", "\n").Replace("\n", Environment.NewLine);
        if (!normalizedContent.EndsWith(Environment.NewLine, StringComparison.Ordinal))
            normalizedContent += Environment.NewLine;

        if (File.Exists(path) && string.Equals(File.ReadAllText(path), normalizedContent, StringComparison.Ordinal))
            return;

        File.WriteAllText(path, normalizedContent);
        generatedFiles.Add(path);
    }

    private static string RenderMatrixConfiguration(BuildMatrixAuthoring matrix) {
        var defaultYear = matrix.RequireDefaultRevitYear();
        var defaultConfiguration = $"{matrix.DefaultBuildKind}.{defaultYear.ConfigurationSuffix}";
        var propertyGroup = new XElement("PropertyGroup",
            new XElement("PeDefaultRevitYear", matrix.DefaultRevitYear),
            new XElement("PeDefaultRevitConfiguration", defaultConfiguration),
            new XElement("PeStableCliConfiguration",
                new XAttribute("Condition", "'$(PeStableCliConfiguration)' == ''"),
                defaultConfiguration
            ),
            new XElement("PeRevitDebugConfigurations",
                string.Join(";", matrix.RevitYears.Select(year => $"Debug.{year.ConfigurationSuffix}"))),
            new XElement("PeRevitReleaseConfigurations",
                string.Join(";", matrix.RevitYears.Select(year => $"Release.{year.ConfigurationSuffix}"))),
            new XElement("PeRevitTestConfigurations",
                string.Join(";", matrix.RevitYears.Select(year => $"Debug.{year.ConfigurationSuffix}.Tests")
                    .Concat(matrix.RevitYears.Select(year => $"Release.{year.ConfigurationSuffix}.Tests")))),
            new XElement("PeSolutionConfigurations",
                string.Join(";",
                    matrix.RevitYears.Select(year => $"Debug.{year.ConfigurationSuffix}")
                        .Concat(matrix.RevitYears.Select(year => $"Release.{year.ConfigurationSuffix}"))
                        .Concat(matrix.RevitYears.Select(year => $"Debug.{year.ConfigurationSuffix}.Tests"))
                        .Concat(matrix.RevitYears.Select(year => $"Release.{year.ConfigurationSuffix}.Tests"))))
        );

        return new XDocument(
            new XElement("Project",
                new XComment($" Generated from {BuildAuthoredPaths.MatrixFilePath}. Do not edit by hand. "),
                propertyGroup
            )
        ).ToString();
    }

    private static string RenderMatrixTargetFramework(BuildMatrixAuthoring matrix) {
        var project = new XElement("Project",
            new XComment($" Generated from {BuildAuthoredPaths.MatrixFilePath}. Do not edit by hand. "),
            new XElement("PropertyGroup",
                new XAttribute("Condition", $"'$(TargetFramework)' == '' and '$(PeTargetFrameworkClass)' == 'SharedNeutral'"),
                new XElement("TargetFramework", matrix.SharedNeutralTargetFramework)
            ),
            new XElement("PropertyGroup",
                new XAttribute("Condition", $"'$(TargetFramework)' == '' and '$(PeTargetFrameworkClass)' == 'OutOfProcNet8'"),
                new XElement("TargetFramework", matrix.OutOfProcTargetFramework)
            )
        );

        foreach (var runtimeGroup in matrix.RevitYears.GroupBy(year => year.RuntimeTargetFramework, StringComparer.Ordinal)) {
            project.Add(new XElement("PropertyGroup",
                new XAttribute(
                    "Condition",
                    $"'$(TargetFramework)' == '' and ('$(PeTargetFrameworkClass)' == 'RevitRuntime' or '$(PeTargetFrameworkClass)' == 'RevitTest') and ({RenderRevitYearCondition(runtimeGroup)})"
                ),
                new XElement("TargetFramework", runtimeGroup.Key)
            ));
        }

        foreach (var automationGroup in matrix.RevitYears
                     .Where(year => year.SupportsAutomationPack)
                     .GroupBy(year => year.AutomationTargetFramework, StringComparer.Ordinal)) {
            project.Add(new XElement("PropertyGroup",
                new XAttribute(
                    "Condition",
                    $"'$(TargetFramework)' == '' and '$(PeTargetFrameworkClass)' == 'AutomationWorker' and ({RenderRevitYearCondition(automationGroup)})"
                ),
                new XElement("TargetFramework", automationGroup.Key)
            ));
        }

        return new XDocument(project).ToString();
    }

    private static string RenderTaxonomyEvaluator(BuildTaxonomy taxonomy) {
        var project = new XElement("Project",
            new XComment($" Generated from {BuildAuthoredPaths.TaxonomyFilePath}. Do not edit by hand. "),
            new XElement("Choose",
                taxonomy.Projects.Select(RenderTaxonomyWhen)
            )
        );

        return new XDocument(project).ToString();
    }

    private static XElement RenderTaxonomyWhen(BuildProjectIdentity project) =>
        new("When",
            new XAttribute("Condition", $"'$(MSBuildProjectName)' == '{project.ProjectName}'"),
            new XElement("PropertyGroup",
                new XElement("PeModuleClass", project.ModuleClass),
                new XElement("PeProductClass", project.ProductClass),
                new XElement("PeTargetFrameworkClass", project.TargetFrameworkClass),
                new XElement("PeIsRevitAwareProject", project.IsRevitAware.ToString().ToLowerInvariant()),
                new XElement("PeSupportsRevitYear", project.SupportsRevitYear.ToString().ToLowerInvariant()),
                new XElement("PeSupportsAttachedRrd", project.SupportsAttachedRrd.ToString().ToLowerInvariant()),
                new XElement("PeSupportsFreshRevitProcess", project.SupportsFreshRevitProcess.ToString().ToLowerInvariant())
            )
        );

    private static string RenderTaxonomyValidationTargets() {
        var target = new XElement("Target",
            new XAttribute("Name", "ValidatePeGeneratedTaxonomy"),
            new XAttribute("BeforeTargets", "PrepareForBuild"),
            new XAttribute("Condition",
                "'$(DesignTimeBuild)' != 'true' and !$([System.String]::Copy('$(MSBuildProjectName)').EndsWith('_wpftmp')) and '$(MSBuildProjectName)' != 'Installer.aot'"
            ),
            new XElement("Error",
                new XAttribute("Condition", "'$(PeHasProjectTaxonomy)' != 'true'"),
                new XAttribute("Text", $"Project '$(MSBuildProjectName)' is missing a build taxonomy entry in {BuildAuthoredPaths.TaxonomyFilePath}.")
            ),
            new XElement("Error",
                new XAttribute("Condition", "'$(PeSupportsRevitYear)' != 'true' and '$(RevitVersion)' != '' and '$(RevitVersion)' != '-1'"),
                new XAttribute("Text",
                    $"Project '$(MSBuildProjectName)' is year-neutral in {BuildAuthoredPaths.TaxonomyFilePath}. Remove RevitVersion or other Revit-year-only behavior from this workflow.")
            ),
            new XElement("Error",
                new XAttribute("Condition", "'$(PeVerifyTarget)' == 'AttachedRrd' and '$(PeSupportsAttachedRrd)' != 'true'"),
                new XAttribute("Text",
                    $"Project '$(MSBuildProjectName)' does not support the AttachedRrd verify target in {BuildAuthoredPaths.TaxonomyFilePath}.")
            ),
            new XElement("Error",
                new XAttribute("Condition", "'$(PeVerifyTarget)' == 'FreshRevitProcess' and '$(PeSupportsFreshRevitProcess)' != 'true'"),
                new XAttribute("Text",
                    $"Project '$(MSBuildProjectName)' does not support the FreshRevitProcess verify target in {BuildAuthoredPaths.TaxonomyFilePath}.")
            )
        );

        return new XDocument(
            new XElement("Project",
                new XComment($" Generated from {BuildAuthoredPaths.TaxonomyFilePath}. Do not edit by hand. "),
                target
            )
        ).ToString();
    }

    private static string RenderPackagePolicy(IReadOnlyList<BuildPackagePolicy> packagePolicies) {
        var project = new XElement("Project",
            new XComment($" Generated from {BuildAuthoredPaths.PackagePolicyFilePath}. Do not edit by hand. "),
            packagePolicies.Select(RenderPackagePolicyGroup)
        );

        return new XDocument(project).ToString();
    }

    private static XElement RenderPackagePolicyGroup(BuildPackagePolicy policy) {
        var itemGroup = new XElement("ItemGroup");
        var condition = RenderPackagePolicyCondition(policy);
        if (!string.IsNullOrWhiteSpace(condition))
            itemGroup.SetAttributeValue("Condition", condition);

        var packageReference = new XElement("PackageReference",
            new XAttribute("Include", policy.PackageId),
            new XAttribute("Version", policy.Version)
        );
        if (!string.IsNullOrWhiteSpace(policy.PrivateAssets))
            packageReference.SetAttributeValue("PrivateAssets", policy.PrivateAssets);

        itemGroup.Add(packageReference);
        return itemGroup;
    }

    private static string RenderPackagePolicyCondition(BuildPackagePolicy policy) {
        var conditions = new List<string>();
        if (!string.IsNullOrWhiteSpace(policy.TargetFramework))
            conditions.Add($"'$(TargetFramework)' == '{policy.TargetFramework}'");

        if (policy.ModuleClasses.Count == 1) {
            conditions.Add($"'$(PeModuleClass)' == '{policy.ModuleClasses[0]}'");
        } else if (policy.ModuleClasses.Count > 1) {
            conditions.Add($"({string.Join(" or ", policy.ModuleClasses.Select(moduleClass => $"'$(PeModuleClass)' == '{moduleClass}'"))})");
        }

        if (!string.IsNullOrWhiteSpace(policy.ProjectName))
            conditions.Add($"'$(MSBuildProjectName)' == '{policy.ProjectName}'");

        return string.Join(" and ", conditions);
    }

    private static string RenderProductLayout(ProductBuildLayoutProjection layout) {
        var properties = new Dictionary<string, string>(StringComparer.Ordinal) {
            ["PeProductVendorName"] = ProductIdentity.VendorName,
            ["PeProductName"] = ProductIdentity.ProductName,
            ["PeRuntimeRootRelativePath"] = layout.Runtime.RootRelativePath,
            ["PeRuntimeBinRelativePath"] = layout.Runtime.Binaries.RootRelativePath,
            ["PeRuntimeHostDirectoryRelativePath"] = layout.Runtime.Binaries.HostDirectoryRelativePath,
            ["PeRuntimeHostExecutableRelativePath"] = layout.Runtime.Binaries.HostExecutableRelativePath,
            ["PeRuntimeHostDllRelativePath"] = layout.Runtime.Binaries.HostDllRelativePath,
            ["PeRuntimePeaDirectoryRelativePath"] = layout.Runtime.Binaries.PeaDirectoryRelativePath,
            ["PeRuntimePeaLauncherRelativePath"] = layout.Runtime.Binaries.PeaLauncherRelativePath,
            ["PeRuntimePeaCurrentVersionRelativePath"] = layout.Runtime.Binaries.PeaCurrentVersionRelativePath,
            ["PeRuntimePeaVersionsRelativePath"] = layout.Runtime.Binaries.PeaVersionsRelativePath,
            ["PeRuntimePeaPackagesRelativePath"] = layout.Runtime.Binaries.PeaPackagesRelativePath,
            ["PeDevCliDirectoryRelativePath"] = layout.Runtime.Binaries.PeDevDirectoryRelativePath,
            ["PeDevCliExecutableRelativePath"] = layout.Runtime.Binaries.PeDevExecutableRelativePath,
            ["PeDevCliDllRelativePath"] = layout.Runtime.Binaries.PeDevDllRelativePath,
            ["PeRuntimeStateRelativePath"] = layout.Runtime.StateRelativePath,
            ["PeRuntimeLogsRelativePath"] = layout.Runtime.LogsRelativePath,
            ["PeRuntimeCacheRelativePath"] = layout.Runtime.CacheRelativePath,
            ["PeDevRuntimeRootRelativePath"] = layout.DevelopmentRuntime.RootRelativePath,
            ["PeDevRuntimeBinRelativePath"] = layout.DevelopmentRuntime.Binaries.RootRelativePath,
            ["PeDevRuntimeHostDirectoryRelativePath"] = layout.DevelopmentRuntime.Binaries.HostDirectoryRelativePath,
            ["PeDevRuntimeHostExecutableRelativePath"] = layout.DevelopmentRuntime.Binaries.HostExecutableRelativePath,
            ["PeDevRuntimeHostDllRelativePath"] = layout.DevelopmentRuntime.Binaries.HostDllRelativePath,
            ["PeUserContentRootRelativePath"] = layout.UserContent.RootRelativePath,
            ["PeUserSettingsRelativePath"] = layout.UserContent.SettingsRelativePath,
            ["PeUserScriptingRelativePath"] = layout.UserContent.ScriptingRelativePath,
            ["PeUserOutputRelativePath"] = layout.UserContent.OutputRelativePath,
            ["PeRevitAddinsRelativePath"] = layout.Revit.AddinsRootRelativePath,
            ["PeRevitAddinManifestFileName"] = layout.Revit.AddinManifestFileName,
            ["PeRevitRuntimeDescriptorFileName"] = RevitDeploymentIdentity.RuntimeDescriptorFileName
        };

        var propertyGroup = new XElement("PropertyGroup",
            properties.Select(property => new XElement(property.Key, property.Value))
        );
        var project = new XElement("Project",
            new XComment(" Generated from Pe.Shared.Product product layout projection. Do not edit by hand. "),
            propertyGroup
        );

        return new XDocument(project).ToString();
    }

    private static string RenderRevitYearCondition(IEnumerable<BuildRevitYearIdentity> years) =>
        string.Join(" or ", years.Select(year => $"'$(RevitVersion)' == '{year.Year}'"));
}
