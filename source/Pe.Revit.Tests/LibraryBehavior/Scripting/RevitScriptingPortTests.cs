using Microsoft.CodeAnalysis;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Execution;
using Pe.Revit.Scripting.References;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class RevitScriptingPortTests {
    [Test]
    public void Project_generation_preserves_user_references_and_packages() {
        var runtimeAssemblyPath = typeof(PeScriptContainer).Assembly.Location;
        var generator = CreateProjectGenerator();
        var existingProject = """
                              <Project Sdk="Microsoft.NET.Sdk">
                                <ItemGroup>
                                  <Reference Include="MyLib">
                                    <HintPath>C:\temp\my-lib.dll</HintPath>
                                  </Reference>
                                  <Reference Include="Pe.Revit.Scripting">
                                    <HintPath>C:\temp\should-be-replaced.dll</HintPath>
                                  </Reference>
                                </ItemGroup>
                                <ItemGroup>
                                  <PackageReference Include="Example.Package" Version="1.2.3" />
                                  <PackageReference Include="Nice3point.Revit.Api.RevitAPI" Version="2025.*" />
                                </ItemGroup>
                              </Project>
                              """;

        var generated = generator.GenerateProjectContent(
            existingProject,
            Path.GetTempPath(),
            "2025",
            "net8.0-windows",
            runtimeAssemblyPath
        );

        Assert.That(generated, Does.Contain("<HintPath>C:\\temp\\my-lib.dll</HintPath>"));
        Assert.That(generated, Does.Contain("""<PackageReference Include="Example.Package" Version="1.2.3" />"""));
        Assert.That(generated, Does.Not.Contain("should-be-replaced.dll"));
    }

    [Test]
    public void Generated_project_contains_required_properties() {
        var runtimeAssemblyPath = typeof(PeScriptContainer).Assembly.Location;
        var generator = CreateProjectGenerator();

        var generated = generator.GenerateProjectContent(
            null,
            Path.GetTempPath(),
            "2025",
            "net8.0-windows",
            runtimeAssemblyPath
        );

        Assert.That(generated, Does.Contain("<EnableDefaultCompileItems>false</EnableDefaultCompileItems>"));
        Assert.That(generated, Does.Contain("""<Compile Include="src/**/*.cs" />"""));
        Assert.That(generated, Does.Contain("<OutputType>Library</OutputType>"));
        Assert.That(generated, Does.Contain("<ProduceReferenceAssembly>false</ProduceReferenceAssembly>"));
    }

    [Test]
    public void Portable_project_generation_omits_references_but_preserves_packages_and_usings() {
        var generator = CreateProjectGenerator();
        var existingProject = """
                              <Project Sdk="Microsoft.NET.Sdk">
                                <PropertyGroup>
                                  <TargetFramework>net8.0-windows</TargetFramework>
                                </PropertyGroup>
                                <ItemGroup>
                                  <Reference Include="MachineSpecific">
                                    <HintPath>C:\temp\machine-specific.dll</HintPath>
                                  </Reference>
                                  <PackageReference Include="Example.Package" Version="1.2.3" />
                                  <Using Include="System.Text.Json" />
                                </ItemGroup>
                              </Project>
                              """;

        var generated = generator.GeneratePortableProjectContent(
            existingProject,
            Path.GetTempPath(),
            "net8.0-windows"
        );

        Assert.That(generated, Does.Contain("""<Compile Include="src/**/*.cs" />"""));
        Assert.That(generated, Does.Contain("""<PackageReference Include="Example.Package" Version="1.2.3" />"""));
        Assert.That(generated, Does.Contain("""<Using Include="System.Text.Json" />"""));
        Assert.That(generated, Does.Not.Contain("machine-specific.dll"));
        Assert.That(generated, Does.Not.Contain("<Reference Include=\"MachineSpecific\">"));
    }

    [Test]
    public void Generated_project_reinjects_current_revit_year_packages() {
        var runtimeAssemblyPath = typeof(PeScriptContainer).Assembly.Location;
        var generator = CreateProjectGenerator();
        var existingProject = """
                              <Project Sdk="Microsoft.NET.Sdk">
                                <ItemGroup>
                                  <PackageReference Include="Nice3point.Revit.Api.RevitAPI" Version="2024.*" />
                                  <PackageReference Include="Nice3point.Revit.Api.RevitAPIUI" Version="2024.*" />
                                  <PackageReference Include="Example.Package" Version="1.2.3" />
                                </ItemGroup>
                              </Project>
                              """;

        var generated = generator.GenerateProjectContent(
            existingProject,
            Path.GetTempPath(),
            "2026",
            "net8.0-windows",
            runtimeAssemblyPath
        );

        Assert.That(generated,
            Does.Contain("""<PackageReference Include="Nice3point.Revit.Api.RevitAPI" Version="2026.*" />"""));
        Assert.That(generated,
            Does.Contain("""<PackageReference Include="Nice3point.Revit.Api.RevitAPIUI" Version="2026.*" />"""));
        Assert.That(generated, Does.Not.Contain("Version=\"2024.*\""));
        Assert.That(generated, Does.Contain("""<PackageReference Include="Example.Package" Version="1.2.3" />"""));
    }

    [Test]
    public void Workspace_bootstrap_creates_workspace_guidance_files() {
        var workspaceKey = $"test-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        try {
            var bootstrapService = new ScriptWorkspaceBootstrapService(CreateProjectGenerator());
            var runtimeAssemblyPath = typeof(PeScriptContainer).Assembly.Location;

            var result = bootstrapService.Bootstrap(
                workspaceKey,
                true,
                "2025",
                "net8.0-windows",
                runtimeAssemblyPath
            );

            var agentsPath = RevitScriptingStorageLocations.ResolveAgentsPath(workspaceKey);
            Assert.That(File.Exists(agentsPath), Is.True);
            Assert.That(File.ReadAllText(agentsPath),
                Does.Contain("Every workspace is a Pod: `pod.json` is validated, all `src/**/*.cs` compile together, and only declared entrypoints are runnable."));
            Assert.That(File.ReadAllText(agentsPath), Does.Contain("add new scripts to `pod.json` under `entrypoints` first"));
            Assert.That(File.ReadAllText(agentsPath), Does.Contain("ReadOnly` (default) runs inside a rollback guard"));
            Assert.That(File.ReadAllText(agentsPath), Does.Not.Contain("lane"));
            Assert.That(File.Exists(result.ProductAgentsPath), Is.True);
            Assert.That(File.Exists(result.ProductReadmePath), Is.True);
            Assert.That(File.Exists(result.WorkspaceReadmePath), Is.True);
            Assert.That(File.ReadAllText(result.WorkspaceReadmePath), Does.Not.Contain("lane"));
            Assert.That(File.Exists(result.PodManifestPath), Is.True);
            Assert.That(File.ReadAllText(result.PodManifestPath), Does.Contain("src/SampleScript.cs"));
            Assert.That(File.ReadAllText(result.SampleScriptPath), Does.Contain("pea script execute --source-path src/SampleScript.cs"));
            Assert.That(File.ReadAllText(result.SampleScriptPath),
                Does.Contain("Keep exactly one non-abstract PeScriptContainer per entrypoint file"));
            Assert.That(result.GeneratedFiles, Does.Contain(agentsPath));
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Generated_project_includes_runtime_support_references_without_host_client_using() {
        var runtimeAssemblyPath = typeof(PeScriptContainer).Assembly.Location;
        var generator = CreateProjectGenerator();

        var generated = generator.GenerateProjectContent(
            null,
            Path.GetTempPath(),
            "2025",
            "net8.0-windows",
            runtimeAssemblyPath
        );

        Assert.That(generated, Does.Contain("""<Reference Include="Pe.Shared.HostContracts">"""));
        Assert.That(generated, Does.Contain("""<Reference Include="Pe.Shared.Product">"""));
        Assert.That(generated, Does.Not.Contain("""<Using Include="Pe.Shared.HostContracts" />"""));
    }

    [Test]
    public void Shared_scripting_workspace_locations_use_product_user_content_root() {
        var basePath = ScriptingWorkspaceLocations.GetDefaultBasePath();
        var workspaceRoot = ScriptingWorkspaceLocations.ResolveWorkspaceRoot("default");

        Assert.That(
            basePath.EndsWith(Path.Combine("Pe.Tools", "workspaces"), StringComparison.OrdinalIgnoreCase),
            Is.True
        );
        Assert.That(
            workspaceRoot.EndsWith(Path.Combine("Pe.Tools", "workspaces", "default"),
                StringComparison.OrdinalIgnoreCase),
            Is.True
        );
    }

    [Test]
    public void Revit_scripting_storage_locations_match_shared_workspace_locations() {
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot("default");

        Assert.That(workspaceRoot, Is.EqualTo(ScriptingWorkspaceLocations.ResolveWorkspaceRoot("default")));
        Assert.That(
            RevitScriptingStorageLocations.ResolveProjectFilePath("default"),
            Is.EqualTo(Path.Combine(workspaceRoot, "PeScripts.csproj"))
        );
        Assert.That(
            RevitScriptingStorageLocations.ResolveInlineTraceDirectory().EndsWith(Path.Combine("Pe.Tools", "inline-scripts"), StringComparison.OrdinalIgnoreCase),
            Is.True
        );

    }

    [Test]
    public void Hint_path_resolution_succeeds_for_existing_dll() {
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var assemblyPath = typeof(PeScriptContainer).Assembly.Location;
        var projectContent = $$"""
                               <Project Sdk="Microsoft.NET.Sdk">
                                 <ItemGroup>
                                   <Reference Include="Pe.Revit.Scripting">
                                     <HintPath>{{assemblyPath}}</HintPath>
                                   </Reference>
                                 </ItemGroup>
                               </Project>
                               """;

        var result = resolver.Resolve(projectContent, Path.GetTempPath());

        Assert.That(result.CompileReferencePaths, Does.Contain(assemblyPath));
        Assert.That(result.RuntimeReferencePaths, Does.Contain(assemblyPath));
        Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error),
            Is.False);
    }

    [Test]
    public void Revit_year_placeholder_hint_path_resolution_succeeds_for_existing_dll() {
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var workspaceRoot = Path.Combine(Path.GetTempPath(), $"pe-script-year-local-{Guid.NewGuid():N}");
        var assemblyPath = Path.Combine(workspaceRoot, "lib", "2025", "Yeared.Local.dll");
        Directory.CreateDirectory(Path.GetDirectoryName(assemblyPath)!);
        File.WriteAllBytes(assemblyPath, [1, 2, 3, 4]);
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <ItemGroup>
                                 <Reference Include="Yeared.Local">
                                   <HintPath>lib\$(RevitYear)\Yeared.Local.dll</HintPath>
                                 </Reference>
                               </ItemGroup>
                             </Project>
                             """;

        try {
            var result = resolver.Resolve(projectContent, workspaceRoot, "2025");

            Assert.That(result.CompileReferencePaths, Does.Contain(assemblyPath));
            Assert.That(result.RuntimeReferencePaths, Does.Contain(assemblyPath));
            Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error),
                Is.False);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Package_reference_resolution_succeeds_for_exact_installed_version() {
        using var packageCache = new TemporaryPackageCache();
        var packageDll = packageCache.AddPackage("Example.Package", "1.2.3", "net8.0", "Example.Package.dll");
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <PropertyGroup>
                                 <TargetFramework>net8.0-windows</TargetFramework>
                               </PropertyGroup>
                               <ItemGroup>
                                 <PackageReference Include="Example.Package" Version="1.2.3" />
                               </ItemGroup>
                             </Project>
                             """;

        var originalNugetPackages = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
        Environment.SetEnvironmentVariable("NUGET_PACKAGES", packageCache.RootPath);
        try {
            var result = resolver.Resolve(projectContent, Path.GetTempPath());
            Assert.That(result.CompileReferencePaths, Does.Contain(packageDll));
            Assert.That(result.RuntimeReferencePaths, Does.Contain(packageDll));
            Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error),
                Is.False);
        } finally {
            Environment.SetEnvironmentVariable("NUGET_PACKAGES", originalNugetPackages);
        }
    }

    [Test]
    public void Wildcard_package_resolution_selects_highest_matching_version() {
        using var packageCache = new TemporaryPackageCache();
        _ = packageCache.AddPackage("Example.Package", "1.2.0", "net8.0", "Example.Package.dll");
        var latestDll = packageCache.AddPackage("Example.Package", "1.2.5", "net8.0", "Example.Package.dll");
        _ = packageCache.AddPackage("Example.Package", "1.3.0", "net8.0", "Example.Package.dll");
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <PropertyGroup>
                                 <TargetFramework>net8.0-windows</TargetFramework>
                               </PropertyGroup>
                               <ItemGroup>
                                 <PackageReference Include="Example.Package" Version="1.2.*" />
                               </ItemGroup>
                             </Project>
                             """;

        var originalNugetPackages = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
        Environment.SetEnvironmentVariable("NUGET_PACKAGES", packageCache.RootPath);
        try {
            var result = resolver.Resolve(projectContent, Path.GetTempPath());
            Assert.That(result.CompileReferencePaths, Does.Contain(latestDll));
            Assert.That(result.RuntimeReferencePaths, Does.Contain(latestDll));
            Assert.That(
                result.CompileReferencePaths.Any(path => path.Contains("1.3.0", StringComparison.OrdinalIgnoreCase)),
                Is.False);
        } finally {
            Environment.SetEnvironmentVariable("NUGET_PACKAGES", originalNugetPackages);
        }
    }

    [Test]
    public void Revit_year_placeholder_package_version_selects_matching_installed_version() {
        using var packageCache = new TemporaryPackageCache();
        var packageDll = packageCache.AddPackage("Yeared.Package", "2025.2.0", "net8.0", "Yeared.Package.dll");
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <PropertyGroup>
                                 <TargetFramework>net8.0-windows</TargetFramework>
                               </PropertyGroup>
                               <ItemGroup>
                                 <PackageReference Include="Yeared.Package" Version="$(RevitYear).*" />
                               </ItemGroup>
                             </Project>
                             """;

        var originalNugetPackages = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
        Environment.SetEnvironmentVariable("NUGET_PACKAGES", packageCache.RootPath);
        try {
            var result = resolver.Resolve(projectContent, Path.GetTempPath(), "2025");
            Assert.That(result.CompileReferencePaths, Does.Contain(packageDll));
            Assert.That(result.RuntimeReferencePaths, Does.Contain(packageDll));
            Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error),
                Is.False);
        } finally {
            Environment.SetEnvironmentVariable("NUGET_PACKAGES", originalNugetPackages);
        }
    }

    [Test]
    public void Missing_or_incompatible_package_produces_diagnostics_without_throwing() {
        using var packageCache = new TemporaryPackageCache();
        packageCache.AddPackage("Broken.Package", "1.0.0", "net9.0", "Broken.Package.dll");
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <PropertyGroup>
                                 <TargetFramework>net48</TargetFramework>
                               </PropertyGroup>
                               <ItemGroup>
                                 <PackageReference Include="Broken.Package" Version="1.0.0" />
                               </ItemGroup>
                             </Project>
                             """;

        var originalNugetPackages = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
        Environment.SetEnvironmentVariable("NUGET_PACKAGES", packageCache.RootPath);
        try {
            var result = resolver.Resolve(projectContent, Path.GetTempPath());
            Assert.That(result.CompileReferencePaths, Is.Empty);
            Assert.That(result.RuntimeReferencePaths, Is.Empty);
            Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error),
                Is.True);
        } finally {
            Environment.SetEnvironmentVariable("NUGET_PACKAGES", originalNugetPackages);
        }
    }

    [Test]
    public void Strict_resolution_rejects_package_that_has_compile_assets_without_runtime_assets() {
        using var packageCache = new TemporaryPackageCache();
        _ = packageCache.AddPackageReferenceOnly("CompileOnly.Package", "1.0.0", "net8.0", "CompileOnly.Package.dll");
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <PropertyGroup>
                                 <TargetFramework>net8.0-windows</TargetFramework>
                               </PropertyGroup>
                               <ItemGroup>
                                 <PackageReference Include="CompileOnly.Package" Version="1.0.0" />
                               </ItemGroup>
                             </Project>
                             """;

        var originalNugetPackages = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
        Environment.SetEnvironmentVariable("NUGET_PACKAGES", packageCache.RootPath);
        try {
            var result = resolver.Resolve(projectContent, Path.GetTempPath());
            Assert.That(result.CompileReferencePaths, Is.Not.Empty);
            Assert.That(result.RuntimeReferencePaths, Is.Empty);
            Assert.That(result.Diagnostics.Any(diagnostic =>
                    diagnostic.Severity == ScriptDiagnosticSeverity.Error
                    && diagnostic.Message.Contains("no compatible runtime assemblies",
                        StringComparison.OrdinalIgnoreCase)),
                Is.True);
        } finally {
            Environment.SetEnvironmentVariable("NUGET_PACKAGES", originalNugetPackages);
        }
    }

    [Test]
    public void Strict_resolution_uses_already_loaded_runtime_assembly_for_compile_only_package_when_available() {
        using var packageCache = new TemporaryPackageCache();
        var loadedAssemblyPath = typeof(PeScriptContainer).Assembly.Location;
        var compileAssemblyPath = packageCache.AddPackageReferenceOnly(
            "CompileOnly.RuntimeBacked.Package",
            "1.0.0",
            "net8.0",
            Path.GetFileName(loadedAssemblyPath)
        );
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <PropertyGroup>
                                 <TargetFramework>net8.0-windows</TargetFramework>
                               </PropertyGroup>
                               <ItemGroup>
                                 <PackageReference Include="CompileOnly.RuntimeBacked.Package" Version="1.0.0" />
                               </ItemGroup>
                             </Project>
                             """;

        var originalNugetPackages = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
        Environment.SetEnvironmentVariable("NUGET_PACKAGES", packageCache.RootPath);
        try {
            var result = resolver.Resolve(projectContent, Path.GetTempPath());
            Assert.That(result.CompileReferencePaths, Does.Contain(compileAssemblyPath));
            Assert.That(result.RuntimeReferencePaths, Does.Contain(loadedAssemblyPath));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                    diagnostic.Severity == ScriptDiagnosticSeverity.Error
                    && diagnostic.Message.Contains("no compatible runtime assemblies",
                        StringComparison.OrdinalIgnoreCase)),
                Is.False);
        } finally {
            Environment.SetEnvironmentVariable("NUGET_PACKAGES", originalNugetPackages);
        }
    }

    [Test]
    public void Strict_resolution_does_not_duplicate_already_loaded_runtime_diagnostics() {
        using var packageCache = new TemporaryPackageCache();
        var loadedAssemblyPath = typeof(PeScriptContainer).Assembly.Location;
        _ = packageCache.AddPackageReferenceOnly(
            "CompileOnly.RuntimeBacked.Package",
            "1.0.0",
            "net8.0",
            Path.GetFileName(loadedAssemblyPath)
        );
        var resolver = new ScriptReferenceResolver(new CsProjReader());
        var projectContent = """
                             <Project Sdk="Microsoft.NET.Sdk">
                               <PropertyGroup>
                                 <TargetFramework>net8.0-windows</TargetFramework>
                               </PropertyGroup>
                               <ItemGroup>
                                 <PackageReference Include="CompileOnly.RuntimeBacked.Package" Version="1.0.0" />
                               </ItemGroup>
                             </Project>
                             """;

        var originalNugetPackages = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
        Environment.SetEnvironmentVariable("NUGET_PACKAGES", packageCache.RootPath);
        try {
            var result = resolver.Resolve(projectContent, Path.GetTempPath());
            var alreadyLoadedMessages = result.Diagnostics
                .Where(diagnostic => diagnostic.Message.Contains("Using already-loaded runtime assembly",
                    StringComparison.OrdinalIgnoreCase))
                .ToList();
            var duplicateResolvedRuntimeMessages = result.Diagnostics
                .Where(diagnostic =>
                    diagnostic.Message.Contains("Resolved package runtime assembly", StringComparison.OrdinalIgnoreCase)
                    && diagnostic.Message.Contains(Path.GetFileName(loadedAssemblyPath),
                        StringComparison.OrdinalIgnoreCase))
                .ToList();

            Assert.That(alreadyLoadedMessages.Count, Is.EqualTo(1));
            Assert.That(duplicateResolvedRuntimeMessages, Is.Empty);
        } finally {
            Environment.SetEnvironmentVariable("NUGET_PACKAGES", originalNugetPackages);
        }
    }

    [Test]
    public void Inline_execution_ignores_workspace_project_file(UIApplication uiApplication) {
        var workspaceKey = $"test-inline-project-override-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(workspaceRoot);

        try {
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveProjectFilePath(workspaceKey),
                """
                <Project Sdk="Microsoft.NET.Sdk">
                  <ItemGroup>
                    <Reference Include="Missing.Local">
                      <HintPath>C:\definitely-missing\Missing.Local.dll</HintPath>
                    </Reference>
                  </ItemGroup>
                </Project>
                """
            );

            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    ScriptContent: """
                    public sealed class InlineOverrideScript : PeScriptContainer
                    {
                        public override void Execute()
                        {
                            WriteLine("override project content used");
                        }
                    }
                    """,
                    WorkspaceKey: workspaceKey
                ),
                "test-inline-project-override"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
            Assert.That(result.Output, Does.Contain("override project content used"));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Message.Contains("Missing.Local.dll", StringComparison.OrdinalIgnoreCase)), Is.False);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Assembly_loader_does_not_add_unreferenced_sibling_dlls_to_metadata_references() {
        var tempDirectory = Path.Combine(Path.GetTempPath(), $"pe-script-assembly-scope-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDirectory);

        try {
            var primaryPath = Path.Combine(tempDirectory, "Primary.dll");
            var siblingPath = Path.Combine(tempDirectory, "Sibling.dll");
            File.Copy(typeof(PeScriptContainer).Assembly.Location, primaryPath);
            File.Copy(typeof(PeScriptContainer).Assembly.Location, siblingPath);

            var diagnostics = new List<ScriptDiagnostic>();
            var loader = new ScriptAssemblyLoadService();
            var scope = loader.CreateScope(
                [primaryPath],
                [primaryPath],
                typeof(PeScriptContainer).Assembly.Location,
                diagnostics
            );

            try {
                Assert.That(scope.MetadataReferences.OfType<PortableExecutableReference>().Any(reference =>
                    string.Equals(reference.FilePath, siblingPath, StringComparison.OrdinalIgnoreCase)), Is.False);
            } finally {
                scope.ResolverScope.Dispose();
            }
        } finally {
            DeleteWorkspace(tempDirectory);
        }
    }

    [Test]
    public void Assembly_loader_does_not_duplicate_already_loaded_assembly_diagnostics() {
        var primaryPath = typeof(PeScriptContainer).Assembly.Location;
        var diagnostics = new List<ScriptDiagnostic>();
        var loader = new ScriptAssemblyLoadService();
        var scope = loader.CreateScope(
            [primaryPath],
            [primaryPath],
            primaryPath,
            diagnostics
        );

        try {
            var alreadyLoadedMessages = diagnostics
                .Where(diagnostic =>
                    diagnostic.Message.Contains("Using already-loaded assembly 'Pe.Revit.Scripting'",
                        StringComparison.OrdinalIgnoreCase))
                .ToList();

            Assert.That(alreadyLoadedMessages.Count, Is.EqualTo(1));
        } finally {
            scope.ResolverScope.Dispose();
        }
    }

    [Test]
    public void No_container_type_is_rejected_with_authoring_hint(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            public sealed class NotAContainer
            {
                private static readonly System.Type ContainerType = typeof(PeScriptContainer);
            }
            """
        ), "test-no-container");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
        Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Stage == "instantiate"), Is.True);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Stage == "authoring"
            && diagnostic.Message.Contains("public override void Execute()", StringComparison.Ordinal)
            && diagnostic.Message.Contains("WriteLine", StringComparison.Ordinal)), Is.True);
    }

    [Test]
    public void Inline_comment_containing_container_name_still_wraps_as_execute_body(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            // PeScriptContainer appears in a comment, not as a container declaration.
            WriteLine("wrapped");
            """
        ), "test-inline-comment-container-name");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
        Assert.That(result.ContainerTypeName, Does.Contain("InlineScript"));
        Assert.That(result.Output, Does.Contain("wrapped"));
    }

    [Test]
    public void Inline_string_containing_container_name_still_wraps_as_execute_body(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            var text = "PeScriptContainer";
            WriteLine(text);
            """
        ), "test-inline-string-container-name");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
        Assert.That(result.ContainerTypeName, Does.Contain("InlineScript"));
        Assert.That(result.Output, Does.Contain("PeScriptContainer"));
    }

    [Test]
    public void Malformed_full_inline_container_is_not_double_wrapped(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            public sealed class BrokenScript : PeScriptContainer
            {
                public override void Execute()
                {
                    WriteLine("broken");
            """
        ), "test-malformed-inline-container");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.CompilationFailed));
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Stage == "compile" && diagnostic.Severity == ScriptDiagnosticSeverity.Error), Is.True);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.None.Contain("InlineScript"));
    }

    [Test]
    public void Multiple_container_types_are_rejected(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            public sealed class ScriptA : PeScriptContainer
            {
                public override void Execute()
                {
                }
            }

            public sealed class ScriptB : PeScriptContainer
            {
                public override void Execute()
                {
                }
            }
            """
        ), "test-multiple-container");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
        Assert.That(
            result.Diagnostics.Any(diagnostic =>
                diagnostic.Message.Contains("Multiple PeScriptContainer", StringComparison.Ordinal)), Is.True);
    }

    [Test]
    public void Compilation_errors_are_returned_with_authoring_hint(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            public sealed class BrokenScript : PeScriptContainer
            {
                public override string Execute()
                {
                    return "wrong shape";
                }
            }
            """
        ), "test-compilation-error");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.CompilationFailed));
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Stage == "compile" && diagnostic.Severity == ScriptDiagnosticSeverity.Error), Is.True);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Stage == "authoring"
            && diagnostic.Message.Contains("Execute-body statements", StringComparison.Ordinal)
            && diagnostic.Message.Contains("Execute() returns void", StringComparison.Ordinal)), Is.True);
    }

    [Test]
    public void WriteTransaction_policy_still_rejects_script_owned_transaction(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            public sealed class TransactionScript : PeScriptContainer
            {
                public override void Execute()
                {
                    if (doc == null)
                        return;

                    using var transaction = new Transaction(doc, "Blocked");
                    _ = transaction.Start();
                    _ = transaction.Commit();
                }
            }
            """,
            PermissionMode: ScriptPermissionMode.WriteTransaction
        ), "test-write-transaction-owned-transaction");

        AssertPolicyRejected(result, "transaction");
    }

    [Test]
    public void ReadOnly_policy_allows_harmless_collection(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            """
            public sealed class CollectorScript : PeScriptContainer
            {
                public override void Execute()
                {
                    if (doc == null)
                    {
                        WriteLine("No active document.");
                        return;
                    }

                    var count = new FilteredElementCollector(doc)
                        .WhereElementIsNotElementType()
                        .Take(3)
                        .Count();
                    WriteLine($"Collected {count} element(s).");
                }
            }
            """
        ), "test-readonly-harmless-collection");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Stage == "policy" && diagnostic.Severity == ScriptDiagnosticSeverity.Error), Is.False);
    }

    [Test]
    public void ReadOnly_mutations_are_rolled_back(UIApplication uiApplication) {
        var document = EnsureActiveProjectDocument(uiApplication);
        var before = document.ProjectInformation.Name;
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            "doc!.ProjectInformation.Name = \"__pe_readonly_rollback__\"; WriteLine(doc.ProjectInformation.Name);"
        ), "test-readonly-rollback");

        var after = document.ProjectInformation.Name;
        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
        Assert.That(result.Output, Does.Contain("__pe_readonly_rollback__"));
        Assert.That(after, Is.EqualTo(before));
        Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Stage == "readonly"), Is.True);
    }

    [Test]
    public void ReadOnly_rejects_when_the_rollback_guard_cannot_start(UIApplication uiApplication) {
        var document = EnsureActiveProjectDocument(uiApplication);
        var service = CreateExecutionService(uiApplication);
        using var transaction = new Transaction(document, "Block scripting rollback guard");
        _ = transaction.Start();

        var result = service.Execute(new ExecuteRevitScriptRequest(
            "WriteLine(\"must not run\");"
        ), "test-readonly-guard-unavailable");

        _ = transaction.RollBack();
        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
        Assert.That(result.Output, Does.Not.Contain("must not run"));
        Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Stage == "readonly"), Is.True);
    }

    [Test]
    public void Script_output_is_bounded(UIApplication uiApplication) {
        _ = EnsureActiveProjectDocument(uiApplication);
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            "WriteLine(new string('x', 300_000));"
        ), "test-output-limit");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
        Assert.That(result.Output.Length, Is.LessThan(300_000));
        Assert.That(result.Output, Does.Contain("output truncated"));
    }

    [Test]
    public void Oversized_inline_source_is_rejected_before_compilation(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);
        var source = "WriteLine(\"x\"); //" + new string('x', 256 * 1024);

        var result = service.Execute(new ExecuteRevitScriptRequest(source), "test-source-limit");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("256 KiB"));
    }

    [Test]
    public void Oversized_structured_result_is_rejected(UIApplication uiApplication) {
        _ = EnsureActiveProjectDocument(uiApplication);
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            "Result(new string('x', 1024 * 1024 + 1));"
        ), "test-result-limit");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.RuntimeFailed));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("1 MiB"));
    }

    [Test]
    public void Oversized_artifact_is_rejected_before_writing(UIApplication uiApplication) {
        _ = EnsureActiveProjectDocument(uiApplication);
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(new ExecuteRevitScriptRequest(
            "Artifacts.WriteText(\"too-large.txt\", new string('x', 10 * 1024 * 1024 + 1));"
        ), "test-artifact-limit");

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.RuntimeFailed));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("10 MiB"));
    }

    [Test]
    public void Inline_snippet_execution_persists_trace_files_without_mutating_workspace_source(UIApplication uiApplication) {
        var workspaceKey = $"test-inline-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        try {
            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    ScriptContent: """
                    public sealed class InlineScript : PeScriptContainer
                    {
                        public override void Execute()
                        {
                            WriteLine("inline script ran");
                        }
                    }
                    """,
                    WorkspaceKey: workspaceKey,
                    SourceName: "SmokeInline.cs"
                ),
                "test-inline-success"
            );

            var inlineTraceDirectory = RevitScriptingStorageLocations.ResolveInlineTraceDirectory();
            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
            Assert.That(result.Output, Does.Contain("inline script ran"));
            Assert.That(Directory.Exists(inlineTraceDirectory), Is.True);
            Assert.That(Directory.Exists(Path.Combine(workspaceRoot, "src")), Is.False);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Inline_body_snippet_allows_leading_using_directives(UIApplication uiApplication) {
        var workspaceKey = $"test-inline-using-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        try {
            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    ScriptContent: """
                    using System.Globalization;

                    WriteLine(CultureInfo.InvariantCulture.Name);
                    """,
                    WorkspaceKey: workspaceKey,
                    SourceName: "UsingInline.cs"
                ),
                "test-inline-using"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
            Assert.That(result.Output, Does.Contain(System.Globalization.CultureInfo.InvariantCulture.Name));
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Compile_failure_guides_document_context_name(UIApplication uiApplication) {
        var workspaceKey = $"test-document-hint-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        try {
            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    ScriptContent: """
                    public sealed class DocumentHintScript : PeScriptContainer
                    {
                        public override void Execute()
                        {
                            var active = Document;
                            WriteLine(active?.Title ?? "No active document.");
                        }
                    }
                    """,
                    WorkspaceKey: workspaceKey,
                    SourceName: "DocumentHint.cs"
                ),
                "test-document-hint"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.CompilationFailed));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Stage == "authoring" &&
                diagnostic.Message.Contains("Use `doc` for the active Revit document", StringComparison.Ordinal)), Is.True);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Inline_compile_failure_references_submitted_source_name(UIApplication uiApplication) {
        var workspaceKey = $"test-inline-fail-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        try {
            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    ScriptContent: """
                    public sealed class BrokenInline : PeScriptContainer
                    {
                        public override void Execute()
                        {
                            DoesNotExist();
                        }
                    }
                    """,
                    WorkspaceKey: workspaceKey,
                    SourceName: "SmokeInlineFail.cs"
                ),
                "test-inline-fail"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.CompilationFailed));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                    diagnostic.Source != null && diagnostic.Source.Contains("SmokeInlineFail.cs", StringComparison.Ordinal)),
                Is.True);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Second_request_after_inline_failure_still_succeeds(UIApplication uiApplication) {
        var workspaceKey = $"test-inline-recovery-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));

        try {
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveSampleScriptPath(workspaceKey),
                """
                public sealed class WorkspaceScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                        WriteLine("workspace script ran");
                    }
                }
                """
            );
            WritePodManifest(workspaceKey, "src/SampleScript.cs");

            var service = CreateExecutionService(uiApplication);
            var failedResult = service.Execute(
                new ExecuteRevitScriptRequest(
                    ScriptContent: """
                    public sealed class BrokenInline : PeScriptContainer
                    {
                        public override void Execute()
                        {
                            DoesNotExist();
                        }
                    }
                    """,
                    WorkspaceKey: workspaceKey
                ),
                "test-inline-first"
            );
            var succeededResult = service.Execute(
                new ExecuteRevitScriptRequest(
                    SourcePath: @"src\SampleScript.cs",
                    WorkspaceKey: workspaceKey
                ),
                "test-inline-second"
            );

            Assert.That(failedResult.Status, Is.EqualTo(ScriptExecutionStatus.CompilationFailed));
            Assert.That(succeededResult.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
            Assert.That(succeededResult.Output, Does.Contain("workspace script ran"));
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Request_without_script_content_or_source_path_is_rejected(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(
            new ExecuteRevitScriptRequest(
                WorkspaceKey: $"test-empty-inline-{Guid.NewGuid():N}"
            ),
            "test-empty-inline"
        );

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Stage == "normalize"
            && diagnostic.Message.Contains("Provide scriptContent (inline C#) or sourcePath", StringComparison.Ordinal)), Is.True);
    }

    [Test]
    public void Request_with_both_script_content_and_source_path_is_rejected(UIApplication uiApplication) {
        var service = CreateExecutionService(uiApplication);

        var result = service.Execute(
            new ExecuteRevitScriptRequest(
                ScriptContent: "WriteLine(\"inline\");",
                SourcePath: @"src\SampleScript.cs",
                WorkspaceKey: $"test-both-sources-{Guid.NewGuid():N}"
            ),
            "test-both-sources"
        );

        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Stage == "normalize"
            && diagnostic.Message.Contains("not both", StringComparison.Ordinal)), Is.True);
    }

    [Test]
    public void Missing_workspace_file_is_rejected(UIApplication uiApplication) {
        var workspaceKey = $"test-missing-workspace-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(workspaceRoot);

        try {
            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    SourcePath: @"src\Missing.cs",
                    WorkspaceKey: workspaceKey
                ),
                "test-missing-workspace"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Stage == "normalize"
                && diagnostic.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase)), Is.True);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Workspace_execution_without_pod_manifest_is_rejected(UIApplication uiApplication) {
        var workspaceKey = $"test-no-pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));

        try {
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveSampleScriptPath(workspaceKey),
                """
                public sealed class WorkspaceScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                        WriteLine("should not run");
                    }
                }
                """
            );

            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    SourcePath: @"src\SampleScript.cs",
                    WorkspaceKey: workspaceKey
                ),
                "test-no-pod"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
            Assert.That(result.Output, Does.Not.Contain("should not run"));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Stage == "pod-manifest"
                && diagnostic.Message.Contains($"Workspace '{workspaceKey}' has no pod.json", StringComparison.Ordinal)
                && diagnostic.Message.Contains("scripting.workspace.bootstrap", StringComparison.Ordinal)), Is.True);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Pod_workspace_execution_compiles_all_src_and_uses_helper_files(UIApplication uiApplication) {
        var workspaceKey = $"test-pod-helper-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));

        try {
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveSampleScriptPath(workspaceKey),
                """
                public sealed class WorkspaceScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                        WriteLine(WorkspaceHelper.Message);
                    }
                }
                """
            );
            File.WriteAllText(
                Path.Combine(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey), "WorkspaceHelper.cs"),
                """
                public static class WorkspaceHelper
                {
                    public const string Message = "pod workspace script ran";
                }

                public sealed class OtherWorkspaceScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                        WriteLine("other workspace script ran");
                    }
                }
                """
            );
            WritePodManifest(workspaceKey, "src/SampleScript.cs");

            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    SourcePath: @"src\SampleScript.cs",
                    WorkspaceKey: workspaceKey
                ),
                "test-pod-helper"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded));
            Assert.That(result.Output, Does.Contain("pod workspace script ran"));
            Assert.That(result.Output, Does.Not.Contain("other workspace script ran"));
            Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Pod mode"));
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Pod_workspace_execution_fails_when_any_src_file_fails_compilation(UIApplication uiApplication) {
        var workspaceKey = $"test-pod-broken-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));

        try {
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveSampleScriptPath(workspaceKey),
                """
                public sealed class WorkspaceScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                        WriteLine("pod workspace script ran");
                    }
                }
                """
            );
            File.WriteAllText(
                Path.Combine(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey), "BrokenSibling.cs"),
                "public sealed class BrokenSibling { public void Nope( }"
            );
            WritePodManifest(workspaceKey, "src/SampleScript.cs");

            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    SourcePath: @"src\SampleScript.cs",
                    WorkspaceKey: workspaceKey
                ),
                "test-pod-broken"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.CompilationFailed));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Stage == "compile" && diagnostic.Severity == ScriptDiagnosticSeverity.Error), Is.True);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Pod_workspace_execution_requires_declared_entrypoint(UIApplication uiApplication) {
        var workspaceKey = $"test-pod-entrypoint-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));

        try {
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveSampleScriptPath(workspaceKey),
                """
                public sealed class WorkspaceScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                        WriteLine("pod workspace script ran");
                    }
                }
                """
            );
            File.WriteAllText(
                Path.Combine(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey), "Other.cs"),
                """
                public sealed class OtherScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                    }
                }
                """
            );
            WritePodManifest(workspaceKey, "src/Other.cs");

            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    SourcePath: @"src\SampleScript.cs",
                    WorkspaceKey: workspaceKey
                ),
                "test-pod-entrypoint"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Stage == "pod-manifest" && diagnostic.Message.Contains("does not declare", StringComparison.Ordinal)), Is.True);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    [Test]
    public void Pod_workspace_execution_rejects_manifest_with_origin_field(UIApplication uiApplication) {
        var workspaceKey = $"test-pod-origin-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));

        try {
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveSampleScriptPath(workspaceKey),
                """
                public sealed class WorkspaceScript : PeScriptContainer
                {
                    public override void Execute()
                    {
                        WriteLine("should not run");
                    }
                }
                """
            );
            // 'origin' was removed from the pod.json schema; the strict validator now rejects it
            // as an unknown field.
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey),
                $$"""
                {
                  "schemaVersion": 1,
                  "id": "{{workspaceKey}}",
                  "name": "{{workspaceKey}}",
                  "version": "1.0.0",
                  "origin": { "path": "C:/pods/legacy" },
                  "entrypoints": [
                    { "id": "main", "sourcePath": "src/SampleScript.cs" }
                  ]
                }
                """
            );

            var service = CreateExecutionService(uiApplication);
            var result = service.Execute(
                new ExecuteRevitScriptRequest(
                    SourcePath: @"src\SampleScript.cs",
                    WorkspaceKey: workspaceKey
                ),
                "test-pod-origin"
            );

            Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Rejected));
            Assert.That(result.Output, Does.Not.Contain("should not run"));
            Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Stage == "pod-manifest" && diagnostic.Message.Contains("Unknown field 'origin'", StringComparison.Ordinal)), Is.True);
        } finally {
            DeleteWorkspace(workspaceRoot);
        }
    }

    private static ScriptProjectGenerator CreateProjectGenerator() =>
        new(new CsProjReader());

    private static RevitScriptExecutionService CreateExecutionService(UIApplication uiApplication) {
        var csProjReader = new CsProjReader();
        var projectGenerator = new ScriptProjectGenerator(csProjReader);
        return new RevitScriptExecutionService(
            projectGenerator,
            new ScriptReferenceResolver(csProjReader),
            new ScriptAssemblyLoadService(),
            new ScriptCompilationService(ScriptFileTemplates.DefaultUsings),
            () => uiApplication
        );
    }

    private static Document EnsureActiveProjectDocument(UIApplication uiApplication) {
        if (uiApplication.ActiveUIDocument?.Document is { } activeDocument)
            return activeDocument;

        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("scripting-active-document");
        var projectPath = Path.Combine(outputDirectory, "Scripting.rvt");
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        projectDocument.SaveAs(projectPath, new SaveAsOptions { OverwriteExistingFile = true });
        _ = projectDocument.Close(false);
        return uiApplication.OpenAndActivateDocument(projectPath).Document;
    }

    private static void WritePodManifest(string workspaceKey, params string[] entrypointSourcePaths) =>
        File.WriteAllText(
            RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey),
            CreatePodManifestText(workspaceKey, entrypointSourcePaths)
        );

    private static string CreatePodManifestText(
        string workspaceKey,
        IReadOnlyList<string> entrypointSourcePaths
    ) {
        var entrypoints = string.Join(",\n", entrypointSourcePaths.Select((sourcePath, index) =>
            $$"""
                { "id": "entry-{{index + 1}}", "sourcePath": "{{sourcePath.Replace("\\", "/")}}" }
              """));

        return $$"""
            {
              "schemaVersion": 1,
              "id": "{{workspaceKey}}",
              "name": "{{workspaceKey}}",
              "version": "1.0.0",
              "entrypoints": [
            {{entrypoints}}
              ]
            }
            """;
    }

    private static void AssertPolicyRejected(ExecuteRevitScriptData result, string expectedDiagnosticText) {
        Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.PolicyRejected));
        Assert.That(result.Diagnostics.Any(diagnostic =>
                diagnostic.Stage == "policy"
                && diagnostic.Severity == ScriptDiagnosticSeverity.Error
                && diagnostic.Message.Contains(expectedDiagnosticText, StringComparison.OrdinalIgnoreCase)),
            Is.True);
    }

    private static void DeleteWorkspace(string workspaceRoot) {
        try {
            if (Directory.Exists(workspaceRoot))
                Directory.Delete(workspaceRoot, true);
        } catch {
            // Best effort temp cleanup.
        }
    }

    private sealed class TemporaryPackageCache : IDisposable {
        public TemporaryPackageCache() {
            this.RootPath = Path.Combine(Path.GetTempPath(), $"pe-script-package-cache-{Guid.NewGuid():N}");
            Directory.CreateDirectory(this.RootPath);
        }

        public string RootPath { get; }

        public void Dispose() => DeleteWorkspace(this.RootPath);

        public string AddPackage(
            string packageName,
            string version,
            string framework,
            string assemblyFileName
        ) {
            var assemblyPath = Path.Combine(
                this.RootPath,
                packageName.ToLowerInvariant(),
                version,
                "lib",
                framework,
                assemblyFileName
            );
            Directory.CreateDirectory(Path.GetDirectoryName(assemblyPath)!);
            File.WriteAllBytes(assemblyPath, [1, 2, 3, 4]);
            return assemblyPath;
        }

        public string AddPackageReferenceOnly(
            string packageName,
            string version,
            string framework,
            string assemblyFileName
        ) {
            var assemblyPath = Path.Combine(
                this.RootPath,
                packageName.ToLowerInvariant(),
                version,
                "ref",
                framework,
                assemblyFileName
            );
            Directory.CreateDirectory(Path.GetDirectoryName(assemblyPath)!);
            File.WriteAllBytes(assemblyPath, [1, 2, 3, 4]);
            return assemblyPath;
        }
    }
}
