using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Global.Services.Host;
using Pe.Host.Contracts;
using Pe.Host.Services;
using Pe.SettingsCatalog;
using Pe.SettingsCatalog.Revit;
using Pe.SettingsCatalog.Revit.AutoTag;
using Pe.StorageRuntime;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
using Pe.StorageRuntime.Revit.Modules;
using HostSettingsModuleDescriptor = Pe.Host.Contracts.SettingsModuleDescriptor;
using HostOpenSettingsDocumentRequest = Pe.Host.Contracts.OpenSettingsDocumentRequest;
using HostSaveSettingsDocumentRequest = Pe.Host.Contracts.SaveSettingsDocumentRequest;
using HostSettingsDocumentId = Pe.Host.Contracts.SettingsDocumentId;
using HostValidateSettingsDocumentRequest = Pe.Host.Contracts.ValidateSettingsDocumentRequest;
using RuntimeSettingsDirectiveScope = Pe.StorageRuntime.Documents.SettingsDirectiveScope;
using RuntimeSettingsDocumentDependencyKind = Pe.StorageRuntime.Documents.SettingsDocumentDependencyKind;
using RuntimeOpenSettingsDocumentRequest = Pe.StorageRuntime.Documents.OpenSettingsDocumentRequest;
using RuntimeSaveSettingsDocumentRequest = Pe.StorageRuntime.Documents.SaveSettingsDocumentRequest;
using RuntimeSettingsDocumentId = Pe.StorageRuntime.Documents.SettingsDocumentId;
using RuntimeValidateSettingsDocumentRequest = Pe.StorageRuntime.Documents.ValidateSettingsDocumentRequest;

namespace Pe.Tools.Tests;

public sealed class SettingsEditorHardeningTests : RevitTestBase {
    private const string SharedStorageModuleKey = "CmdFFMigrator";

    [Test]
    public async Task EnvelopeCode_includes_NoDocument_for_machine_readable_precondition_failures() {
        var names = Enum.GetNames(typeof(EnvelopeCode));

        await Assert.That(names).Contains(nameof(EnvelopeCode.NoDocument));
    }

    [Test]
    public async Task Hub_requests_do_not_expose_subdirectory() {
        await Assert.That(typeof(ValidateSettingsRequest).GetProperties())
            .DoesNotContain(property =>
                string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase));
    }

    [Test]
    public async Task ParameterCatalogRequest_uses_context_values() {
        var properties = typeof(ParameterCatalogRequest).GetProperties()
            .Select(property => property.Name)
            .ToList();

        await Assert.That(properties).Contains(nameof(ParameterCatalogRequest.ContextValues));
        await Assert.That(properties).DoesNotContain("SiblingValues");
    }

    [Test]
    public async Task Hub_method_names_drop_storage_crud_and_keep_bridge_contract() {
        var methods = typeof(HubMethodNames).GetFields()
            .Where(field => field.IsLiteral)
            .Select(field => field.GetRawConstantValue()?.ToString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToList();

        await Assert.That(methods).Contains(nameof(HubMethodNames.GetHostStatusEnvelope));
        await Assert.That(methods).DoesNotContain(nameof(HubMethodNames.GetType));
        await Assert.That(methods).DoesNotContain("DiscoverSettingsDocuments");
        await Assert.That(methods).DoesNotContain("OpenSettingsDocument");
        await Assert.That(methods).DoesNotContain("ComposeSettingsDocument");
        await Assert.That(methods).DoesNotContain("SaveSettingsDocument");
    }

    [Test]
    public async Task Json_serializes_contracts_as_camel_case_and_omits_nulls() {
        var payload = new HostStatusData(
            true,
            true,
            ProviderMode.BridgeEnhanced,
            true,
            "Test Model",
            "2025",
            ".NET 8.0",
            HostProtocol.ContractVersion,
            HostProtocol.Transport,
            null,
            BridgeProtocol.ContractVersion,
            BridgeProtocol.Transport,
            [
                new HostSettingsModuleDescriptor(
                    "FFMigrator",
                    "profiles"
                )
            ],
            null
        );

        var json = JsonConvert.SerializeObject(payload, CreateSerializerSettings());

        await Assert.That(json).Contains($"\"hostContractVersion\":{HostProtocol.ContractVersion}");
        await Assert.That(json).Contains("\"availableModules\"");
        await Assert.That(json).Contains("\"moduleKey\":\"FFMigrator\"");
        await Assert.That(json).Contains("\"defaultRootKey\":\"profiles\"");
        await Assert.That(json).DoesNotContain("serverVersion");
    }

    [Test]
    public async Task DocumentInvalidationEvent_exposes_machine_readable_reason_and_flags() {
        var payload = new DocumentInvalidationEvent(
            DocumentInvalidationReason.Changed,
            "Test Model",
            true,
            true,
            true,
            false
        );

        await Assert.That(payload.Reason).IsEqualTo(DocumentInvalidationReason.Changed);
        await Assert.That(payload.InvalidateFieldOptions).IsTrue();
        await Assert.That(payload.InvalidateCatalogs).IsTrue();
        await Assert.That(payload.InvalidateSchema).IsFalse();
    }

    [Test]
    public async Task HostStatusChangedEvent_exposes_machine_readable_reason_and_document_state() {
        var payload = new HostStatusChangedEvent(
            HostStatusChangedReason.ActiveDocumentChanged,
            true,
            "Test Model"
        );

        await Assert.That(payload.Reason).IsEqualTo(HostStatusChangedReason.ActiveDocumentChanged);
        await Assert.That(payload.HasActiveDocument).IsTrue();
        await Assert.That(payload.DocumentTitle).IsEqualTo("Test Model");
    }

    [Test]
    public async Task BridgeProtocol_exposes_named_pipe_defaults() {
        await Assert.That(BridgeProtocol.Transport).IsEqualTo("named-pipes");
        await Assert.That(BridgeProtocol.DefaultPipeName).IsEqualTo("Pe.Host.Bridge");
    }

    [Test]
    public async Task Contracts_assembly_does_not_include_runtime_helpers() {
        var contractsAssembly = typeof(BridgeProtocol).Assembly;

        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.HostEnvironment")).IsNull();
        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.Json")).IsNull();
    }

    [Test]
    public async Task HostStatusData_serializes_machine_readable_state() {
        var payload = new HostStatusData(
            true,
            true,
            ProviderMode.BridgeEnhanced,
            true,
            "Active Model",
            "2025",
            ".NET 8.0",
            HostProtocol.ContractVersion,
            HostProtocol.Transport,
            "1.2.3",
            BridgeProtocol.ContractVersion,
            BridgeProtocol.Transport,
            [
                new HostSettingsModuleDescriptor(
                    "FFMigrator",
                    "profiles"
                )
            ],
            null
        );

        var json = JsonConvert.SerializeObject(payload, CreateSerializerSettings());

        await Assert.That(json).Contains("\"hostIsRunning\":true");
        await Assert.That(json).Contains("\"bridgeIsConnected\":true");
        await Assert.That(json).Contains("\"providerMode\":\"BridgeEnhanced\"");
        await Assert.That(json).Contains("\"activeDocumentTitle\":\"Active Model\"");
        await Assert.That(json).Contains($"\"hostTransport\":\"{HostProtocol.Transport}\"");
        await Assert.That(json).Contains("\"bridgeTransport\":\"named-pipes\"");
    }

    [Test]
    public async Task BridgeFrame_serializes_kind_and_payload_as_camel_case() {
        var frame = new BridgeFrame(
            BridgeFrameKind.Handshake,
            new BridgeHandshake(
                BridgeProtocol.ContractVersion,
                BridgeProtocol.Transport,
                "2025",
                ".NET 8.0",
                true,
                "Test Model",
                []
            )
        );

        var json = JsonConvert.SerializeObject(frame, CreateSerializerSettings());

        await Assert.That(json).Contains("\"kind\":\"Handshake\"");
        await Assert.That(json).Contains("\"handshake\"");
        await Assert.That(json).Contains("\"activeDocumentTitle\":\"Test Model\"");
    }

    [Test]
    public async Task ResolveSafeSubDirectoryPath_rejects_traversal_segments() {
        var root = Path.Combine(Path.GetTempPath(), "pe-tools-settings-hardening");
        _ = Directory.CreateDirectory(root);

        _ = await Assert.That(() => SettingsPathing.ResolveSafeSubDirectoryPath(root, "../sibling", "subdirectory"))
            .Throws<ArgumentException>();
    }

    [Test]
    public async Task ThrottleGate_coalesces_inflight_and_caches() {
        var gate = new ThrottleGate();
        var key = "conn:examples:FFMigrator:FamilyName";
        var invoked = 0;
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        async Task<string> Factory() {
            _ = Interlocked.Increment(ref invoked);
            _ = await release.Task;
            return "ok";
        }

        var firstTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        var secondTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        release.SetResult(true);

        var first = await firstTask;
        var second = await secondTask;

        await Assert.That(Volatile.Read(ref invoked)).IsEqualTo(1);
        await Assert.That(first.Result).IsEqualTo("ok");
        await Assert.That(second.Result).IsEqualTo("ok");
        await Assert.That(new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced }).Contains(first.Decision);
        await Assert.That(new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced }).Contains(second.Decision);

        var cached = await gate.ExecuteAsync(
            key,
            TimeSpan.FromMilliseconds(250),
            () => Task.FromResult("should-not-run")
        );

        await Assert.That(cached.Decision).IsEqualTo(ThrottleDecision.CacheHit);
        await Assert.That(cached.Result).IsEqualTo("ok");
    }

    [Test]
    public async Task Host_services_no_longer_include_TaskQueue_wrapper() => await Assert
        .That(typeof(RequestService).Assembly.GetType("Pe.Global.Services.Host.TaskQueue")).IsNull();

    [Test]
    public async Task Global_assembly_no_longer_contains_legacy_json_composition_or_validation_types() {
        var globalAssembly = typeof(RequestService).Assembly;

        await Assert.That(globalAssembly.GetType("Pe.Global.Services.Host.ValidationIssueMapper")).IsNull();
        await Assert.That(globalAssembly.GetType("Pe.Global.Services.Storage.Core.Json.JsonArrayComposer")).IsNull();
        await Assert.That(globalAssembly.GetType("Pe.Global.Services.Storage.Core.Json.JsonPresetComposer")).IsNull();
        await Assert.That(globalAssembly.GetType("Pe.Global.Services.Storage.Core.Json.JsonCompositionException")).IsNull();
        await Assert.That(globalAssembly.GetType("Pe.Global.Services.Storage.Core.Json.JsonCompositionPipeline")).IsNull();
    }

    [Test]
    public async Task SettingsDocumentId_builds_stable_identity_from_module_root_and_relative_path() {
        var id = new RuntimeSettingsDocumentId("AutoTag", "settings", "autotag/profile.json");

        await Assert.That(id.ModuleKey).IsEqualTo("AutoTag");
        await Assert.That(id.RootKey).IsEqualTo("settings");
        await Assert.That(id.RelativePath).IsEqualTo("autotag/profile.json");
        await Assert.That(id.StableId).IsEqualTo("autotag:settings:autotag/profile.json");
    }

    [Test]
    public async Task SettingsModuleRegistry_projects_runtime_module_descriptors() {
        var registry = new SettingsModuleRegistry();
        KnownSettingsRevitModules.RegisterKnownSettingsModules(registry);

        var descriptors = registry.GetModuleDescriptors().ToList();
        await Assert.That(descriptors.Count).IsEqualTo(KnownSettingsSchemas.Authoring.Count);
        var descriptor = descriptors.Single(module => string.Equals(module.ModuleKey, "AutoTag", StringComparison.Ordinal));
        await Assert.That(descriptor.ModuleKey).IsEqualTo("AutoTag");
        await Assert.That(descriptor.DefaultSubDirectory).IsEqualTo("autotag");
        await Assert.That(descriptor.SettingsType).IsEqualTo(typeof(AutoTagSettings));
        await Assert.That(descriptor.StorageOptions.IncludeRoots).IsEmpty();
        await Assert.That(descriptor.StorageOptions.PresetRoots).IsEmpty();
    }

    [Test]
    public async Task Host_settings_catalog_stays_in_parity_with_runtime_module_registry() {
        var registry = new SettingsModuleRegistry();
        KnownSettingsRevitModules.RegisterKnownSettingsModules(registry);

        var runtimeDescriptors = registry.GetModuleDescriptors()
            .OrderBy(descriptor => descriptor.ModuleKey, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var catalogDescriptors = KnownSettingsSchemas.Authoring
            .OrderBy(schema => schema.ModuleKey, StringComparer.OrdinalIgnoreCase)
            .ToList();

        await Assert.That(runtimeDescriptors.Count).IsEqualTo(catalogDescriptors.Count);
        for (var index = 0; index < runtimeDescriptors.Count; index++) {
            var runtimeDescriptor = runtimeDescriptors[index];
            var catalogDescriptor = catalogDescriptors[index];

            await Assert.That(runtimeDescriptor.ModuleKey).IsEqualTo(catalogDescriptor.ModuleKey);
            await Assert.That(runtimeDescriptor.DefaultSubDirectory).IsEqualTo(catalogDescriptor.DefaultSubDirectory);
            await Assert.That(runtimeDescriptor.SettingsType).IsEqualTo(catalogDescriptor.SettingsType);
            await Assert.That(runtimeDescriptor.StorageOptions.IncludeRoots.OrderBy(root => root))
                .IsEquivalentTo(catalogDescriptor.StorageOptions.IncludeRoots.OrderBy(root => root));
            await Assert.That(runtimeDescriptor.StorageOptions.PresetRoots.OrderBy(root => root))
                .IsEquivalentTo(catalogDescriptor.StorageOptions.PresetRoots.OrderBy(root => root));
        }
    }

    [Test]
    public async Task Host_settings_catalog_uses_shared_known_storage_definition_lookup() {
        var catalog = new HostSettingsModuleCatalog();
        var hostDefinitions = catalog.GetStorageDefinitions();
        var sharedDefinitions = KnownSettingsStorageDefinitions.Create(
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
        );

        await Assert.That(hostDefinitions.Keys.OrderBy(key => key))
            .IsEquivalentTo(sharedDefinitions.Keys.OrderBy(key => key));

        foreach (var moduleKey in sharedDefinitions.Keys) {
            var hostDefinition = hostDefinitions[moduleKey];
            var sharedDefinition = sharedDefinitions[moduleKey];

            await Assert.That(hostDefinition.DefaultRootKey).IsEqualTo(sharedDefinition.DefaultRootKey);
            await Assert.That(hostDefinition.AllowedRootKeys.OrderBy(root => root))
                .IsEquivalentTo(sharedDefinition.AllowedRootKeys.OrderBy(root => root));
            await Assert.That(hostDefinition.StorageOptions.IncludeRoots.OrderBy(root => root))
                .IsEquivalentTo(sharedDefinition.StorageOptions.IncludeRoots.OrderBy(root => root));
            await Assert.That(hostDefinition.StorageOptions.PresetRoots.OrderBy(root => root))
                .IsEquivalentTo(sharedDefinition.StorageOptions.PresetRoots.OrderBy(root => root));
            await Assert.That(hostDefinition.Validator != null).IsEqualTo(sharedDefinition.Validator != null);
        }
    }

    [Test]
    public async Task Host_settings_catalog_projects_global_fragment_authority_and_module_validators() {
        var catalog = new HostSettingsModuleCatalog();
        var workspaces = catalog.GetWorkspaces();
        var defaultWorkspace = workspaces.Workspaces.Single();
        var globalWorkspace = defaultWorkspace.Modules.Single(module =>
            string.Equals(module.ModuleKey, "Global", StringComparison.OrdinalIgnoreCase));
        var definitions = catalog.GetStorageDefinitions();

        await Assert.That(globalWorkspace.DefaultRootKey).IsEqualTo("fragments");
        await Assert.That(globalWorkspace.Roots.Select(root => root.RootKey))
            .Contains(rootKey => string.Equals(rootKey, "fragments", StringComparison.OrdinalIgnoreCase));
        await Assert.That(definitions["CmdFFMigrator"].Validator).IsNotNull();
        await Assert.That(definitions["Global"].AllowedRootKeys)
            .Contains(rootKey => string.Equals(rootKey, "fragments", StringComparison.OrdinalIgnoreCase));
    }

    [Test]
    public async Task Shared_directive_root_catalog_exposes_expected_global_roots() {
        await Assert.That(SettingsDirectiveRootCatalog.GlobalIncludeRoots.OrderBy(root => root))
            .IsEquivalentTo(new[] {
                "_family-names", "_fields", "_mapping-data", "_shared-parameter-names", "_stress-mapping-data",
                "_test-items"
            }.OrderBy(root => root));
        await Assert.That(SettingsDirectiveRootCatalog.GlobalPresetRoots.OrderBy(root => root))
            .IsEquivalentTo(new[] { "_filter-aps-params", "_filter-families" }.OrderBy(root => root));
    }

    [Test]
    public async Task SettingsModuleBase_projects_storage_policy_from_settings_type() {
        var module = new SharedStorageSpikeProofModule();

        await Assert.That(module.StorageOptions.IncludeRoots)
            .Contains(root => string.Equals(root, "_shared", StringComparison.OrdinalIgnoreCase));
        await Assert.That(module.StorageOptions.PresetRoots).IsEmpty();
    }

    [Test]
    public async Task Field_option_descriptors_distinguish_revit_assembly_and_live_document_sources() {
        await Assert.That(new PropertyGroupNamesProvider().Describe().RequiredCapabilities)
            .IsEqualTo(SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly);
        await Assert.That(new FamilyNamesProvider().Describe().RequiredCapabilities)
            .IsEqualTo(SettingsRuntimeCapabilityProfiles.LiveDocument);
    }

    [Test]
    public async Task Host_local_field_options_failures_are_not_reported_as_success() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new ThrowingFieldOptionsTestSettingsDefinition());

        var module = new SettingsSchemaRegistration(
            new SettingsCatalogModule(
                "ThrowingFieldOptions",
                "profiles",
                SettingsStorageModuleOptions.Empty
            ),
            typeof(ThrowingFieldOptionsTestSettings)
        );
        var service = new HostSettingsEditorService(new TestHostSettingsModuleCatalog([module]));

        var handled = service.TryGetFieldOptionsEnvelopeLocally(
            new FieldOptionsRequest(
                module.ModuleKey,
                nameof(ThrowingFieldOptionsTestSettings.Value),
                nameof(ThrowingFieldOptionsSource),
                null
            ),
            out var response
        );

        await Assert.That(handled).IsTrue();
        await Assert.That(response.Ok).IsFalse();
        await Assert.That(response.Code).IsEqualTo(EnvelopeCode.Failed);
        await Assert.That(response.Message).IsEqualTo("boom");
        await Assert.That(response.Issues)
            .Contains(issue => string.Equals(issue.Code, "FieldOptionsException", StringComparison.Ordinal));
        await Assert.That(response.Data?.Items).IsEmpty();
    }

    [Test]
    public async Task Shared_storage_supports_discover_open_compose_and_save_for_ffmigrator_shape() {
        using var sandbox = new TempDir("shared-storage-consumption");
        var documentId = new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");
        var moduleDefinitions = CreateSharedStorageModuleDefinitions();
        var revitConsumer = new SharedModuleSettingsStorage(
            new SharedStorageSpikeProofModule(),
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
            moduleDefinitions,
            sandbox.Path
        );
        var sharedBackend = new LocalDiskSettingsStorageBackend(
            sandbox.Path,
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
            moduleDefinitions
        );
        WriteComposableProfileFixture(sandbox.Path, documentId);

        var discovery = await revitConsumer.DiscoverAsync();
        await Assert.That(discovery.Files.Any(entry =>
                string.Equals(entry.RelativePath, "profile-a.json", StringComparison.OrdinalIgnoreCase)))
            .IsTrue();

        var opened = await revitConsumer.OpenAsync(documentId.RelativePath);
        await Assert.That(opened.Metadata.DocumentId.ModuleKey).IsEqualTo(SharedStorageModuleKey);
        await Assert.That(opened.Metadata.DocumentId.RootKey).IsEqualTo("profiles");
        await Assert.That(opened.Metadata.VersionToken).IsNotNull();
        await Assert.That(opened.RawContent).Contains("\"$include\"");

        var composed = await sharedBackend.ComposeAsync(new RuntimeOpenSettingsDocumentRequest(documentId, true));
        await Assert.That(composed.ComposedContent).IsNotNull();
        await Assert.That(composed.ComposedContent!).Contains("\"Name\": \"fragment-a\"");
        await Assert.That(composed.Dependencies)
            .Contains(dependency =>
                string.Equals(
                    dependency.DocumentId.RelativePath,
                    "_shared/item-a.json",
                    StringComparison.OrdinalIgnoreCase
                ) &&
                dependency.Scope == RuntimeSettingsDirectiveScope.Local &&
                dependency.Kind == RuntimeSettingsDocumentDependencyKind.Include);
        await Assert.That(composed.Validation.IsValid).IsTrue();
        await Assert.That(composed.CapabilityHints["availableCapabilities"])
            .Contains("\"hasRevitAssembly\":true");
        await Assert.That(composed.CapabilityHints["compositionPolicy"]).IsEqualTo("module-scoped");

        var saved = await sharedBackend.SaveAsync(new RuntimeSaveSettingsDocumentRequest(
            documentId,
            """
            {
              "Items": []
            }
            """,
            opened.Metadata.VersionToken
        ));
        await Assert.That(saved.WriteApplied).IsTrue();
        await Assert.That(saved.ConflictDetected).IsFalse();
        await Assert.That(saved.Validation.IsValid).IsTrue();

        var reopened = await revitConsumer.OpenAsync(documentId.RelativePath);
        await Assert.That(reopened.RawContent).Contains("\"Items\": []");
    }

    [Test]
    public async Task Shared_storage_save_detects_stale_version_tokens() {
        using var sandbox = new TempDir("shared-storage-stale-token");
        var documentId = new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");
        var sharedBackend = new LocalDiskSettingsStorageBackend(
            sandbox.Path,
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
            CreateSharedStorageModuleDefinitions()
        );
        WriteSimpleProfileFixture(sandbox.Path, documentId);

        var opened = await sharedBackend.OpenAsync(new RuntimeOpenSettingsDocumentRequest(documentId));
        var firstSave = await sharedBackend.SaveAsync(new RuntimeSaveSettingsDocumentRequest(
            documentId,
            """
            {
              "Name": "updated-once"
            }
            """,
            opened.Metadata.VersionToken
        ));
        var staleSave = await sharedBackend.SaveAsync(new RuntimeSaveSettingsDocumentRequest(
            documentId,
            """
            {
              "Name": "stale-write"
            }
            """,
            opened.Metadata.VersionToken
        ));

        await Assert.That(firstSave.ConflictDetected).IsFalse();
        await Assert.That(firstSave.WriteApplied).IsTrue();
        await Assert.That(staleSave.ConflictDetected).IsTrue();
        await Assert.That(staleSave.WriteApplied).IsFalse();
        await Assert.That(staleSave.ConflictMessage).Contains("changed on disk");
    }

    [Test]
    public async Task Shared_storage_rejects_unknown_module_authority() {
        using var sandbox = new TempDir("shared-storage-missing-policy");
        var documentId = new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");
        var sharedBackend = new LocalDiskSettingsStorageBackend(sandbox.Path);
        WriteComposableProfileFixture(sandbox.Path, documentId);

        _ = await Assert.That(() => sharedBackend.ComposeAsync(new RuntimeOpenSettingsDocumentRequest(documentId, true)))
            .Throws<InvalidOperationException>();
    }

    [Test]
    public async Task Shared_storage_rejects_unknown_root_authority() {
        using var sandbox = new TempDir("shared-storage-invalid-root");
        var documentId = new RuntimeSettingsDocumentId(SharedStorageModuleKey, "other-root", "profile-a");
        var sharedBackend = new LocalDiskSettingsStorageBackend(
            sandbox.Path,
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
            CreateSharedStorageModuleDefinitions()
        );

        _ = await Assert.That(() => sharedBackend.OpenAsync(new RuntimeOpenSettingsDocumentRequest(documentId)))
            .Throws<InvalidOperationException>();
    }

    [Test]
    public async Task Shared_storage_save_rejects_invalid_include_root_during_preflight() {
        using var sandbox = new TempDir("shared-storage-invalid-include-root");
        var documentId = new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");
        var sharedBackend = new LocalDiskSettingsStorageBackend(
            sandbox.Path,
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
            CreateSharedStorageModuleDefinitions()
        );

        var result = await sharedBackend.SaveAsync(new RuntimeSaveSettingsDocumentRequest(
            documentId,
            """
            {
              "Items": [
                {
                  "$include": "@local/_not-allowed/item-a"
                }
              ]
            }
            """
        ));

        await Assert.That(result.WriteApplied).IsFalse();
        await Assert.That(result.ConflictDetected).IsFalse();
        await Assert.That(result.Validation.IsValid).IsFalse();
        await Assert.That(result.Validation.Issues)
            .Contains(issue => string.Equals(issue.Code, "CompositionError", StringComparison.Ordinal));
    }

    [Test]
    public async Task Shared_storage_tracks_global_fragment_dependencies() {
        using var sandbox = new TempDir("shared-storage-global-deps");
        var documentId = new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");
        var sharedBackend = new LocalDiskSettingsStorageBackend(
            sandbox.Path,
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
            CreateSharedStorageModuleDefinitions()
        );
        WriteGlobalComposableProfileFixture(sandbox.Path, documentId);

        var composed = await sharedBackend.ComposeAsync(new RuntimeOpenSettingsDocumentRequest(documentId, true));

        await Assert.That(composed.Dependencies).Contains(dependency =>
            string.Equals(dependency.DocumentId.ModuleKey, "Global", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(dependency.DocumentId.RootKey, "fragments", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(
                dependency.DocumentId.RelativePath,
                "_shared/global-item.json",
                StringComparison.OrdinalIgnoreCase
            ) &&
            dependency.Scope == RuntimeSettingsDirectiveScope.Global);
    }

    [Test]
    public async Task Host_storage_reopens_and_saves_global_fragment_dependencies() {
        using var sandbox = new TempDir("host-storage-global-deps");
        var hostCatalog = new HostSettingsModuleCatalog();
        var hostStorage = new HostSettingsStorageService(hostCatalog, sandbox.Path);
        var documentId = new HostSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");

        WriteGlobalComposableProfileFixture(
            sandbox.Path,
            new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a")
        );

        var composed = await hostStorage.ComposeAsync(new HostOpenSettingsDocumentRequest(documentId, true));
        var globalDependency = composed.Dependencies.Single(dependency =>
            string.Equals(dependency.DocumentId.ModuleKey, "Global", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(dependency.DocumentId.RootKey, "fragments", StringComparison.OrdinalIgnoreCase));
        var openedDependency = await hostStorage.OpenAsync(
            new HostOpenSettingsDocumentRequest(globalDependency.DocumentId, true)
        );

        await Assert.That(openedDependency.RawContent).Contains("\"global-fragment\"");

        var savedDependency = await hostStorage.SaveAsync(new HostSaveSettingsDocumentRequest(
            globalDependency.DocumentId,
            """
            {
              "Items": [
                {
                  "Name": "global-fragment-updated"
                }
              ]
            }
            """,
            openedDependency.Metadata.VersionToken
        ));
        var reopenedDependency = await hostStorage.OpenAsync(
            new HostOpenSettingsDocumentRequest(globalDependency.DocumentId, true)
        );

        await Assert.That(savedDependency.WriteApplied).IsTrue();
        await Assert.That(savedDependency.ConflictDetected).IsFalse();
        await Assert.That(reopenedDependency.RawContent).Contains("\"global-fragment-updated\"");
    }

    [Test]
    public async Task Host_storage_open_synchronizes_profile_and_fragment_schema_artifacts() {
        using var sandbox = new TempDir("host-storage-schema-sync-open");
        var module = new SettingsSchemaRegistration(
            new SettingsCatalogModule(
                SharedStorageModuleKey,
                "profiles",
                new SettingsStorageModuleOptions(["_shared"], [])
            ),
            typeof(SharedStorageSpikeProofSettings)
        );
        var hostCatalog = new TestHostSettingsModuleCatalog([module]);
        var hostStorage = new HostSettingsStorageService(hostCatalog, sandbox.Path);
        var documentId = new HostSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");

        WriteComposableProfileFixture(
            sandbox.Path,
            new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a")
        );

        var opened = await hostStorage.OpenAsync(new HostOpenSettingsDocumentRequest(documentId, true));
        var profilesRoot = ResolveProfilesRoot(
            sandbox.Path,
            new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a")
        );
        var profilePath = Path.Combine(profilesRoot, "profile-a.json");
        var fragmentPath = Path.Combine(profilesRoot, "_shared", "item-a.json");
        var profileSchemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(
            profilesRoot,
            typeof(SharedStorageSpikeProofSettings)
        );
        var fragmentSchemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            profilesRoot,
            SettingsPathing.DirectiveScope.Local,
            false,
            "_shared"
        );

        await Assert.That(opened.RawContent).Contains("\"$schema\"");
        await Assert.That(File.ReadAllText(profilePath)).Contains("\"$schema\"");
        await Assert.That(File.ReadAllText(fragmentPath)).Contains("\"$schema\"");
        await Assert.That(File.Exists(profileSchemaPath)).IsTrue();
        await Assert.That(File.Exists(fragmentSchemaPath)).IsTrue();
    }

    [Test]
    public async Task Host_storage_save_injects_profile_schema_reference_before_write() {
        using var sandbox = new TempDir("host-storage-schema-sync-save");
        var module = new SettingsSchemaRegistration(
            new SettingsCatalogModule(
                "SimpleModule",
                "profiles",
                SettingsStorageModuleOptions.Empty
            ),
            typeof(SimpleNamedSettings)
        );
        var hostCatalog = new TestHostSettingsModuleCatalog([module]);
        var hostStorage = new HostSettingsStorageService(hostCatalog, sandbox.Path);
        var documentId = new HostSettingsDocumentId("SimpleModule", "profiles", "profile-a");
        var profilesRoot = ResolveProfilesRoot(
            sandbox.Path,
            new RuntimeSettingsDocumentId("SimpleModule", "profiles", "profile-a")
        );
        var profilePath = Path.Combine(profilesRoot, "profile-a.json");
        var schemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(
            profilesRoot,
            typeof(SimpleNamedSettings)
        );

        var saveResult = await hostStorage.SaveAsync(new HostSaveSettingsDocumentRequest(
            documentId,
            """
            {
              "Name": "saved"
            }
            """
        ));

        await Assert.That(saveResult.WriteApplied).IsTrue();
        await Assert.That(File.ReadAllText(profilePath)).Contains("\"$schema\"");
        await Assert.That(File.Exists(schemaPath)).IsTrue();
    }

    [Test]
    public async Task Host_storage_validate_uses_runtime_module_schema_validator() {
        using var sandbox = new TempDir("host-storage-validate");
        var hostCatalog = new HostSettingsModuleCatalog();
        var hostStorage = new HostSettingsStorageService(hostCatalog, sandbox.Path);
        var documentId = new HostSettingsDocumentId("AutoTag", "autotag", "autotag-settings");

        var validation = await hostStorage.ValidateAsync(new HostValidateSettingsDocumentRequest(
            documentId,
            """
            {
              "Bogus": true
            }
            """
        ));

        await Assert.That(validation.IsValid).IsFalse();
        await Assert.That(validation.Issues)
            .Contains(issue => string.Equals(issue.Code, "NoAdditionalPropertiesAllowed", StringComparison.Ordinal));
    }

    [Test]
    public async Task Shared_runtime_backend_does_not_reference_revit_assemblies_for_static_capability_flow() {
        var referencedAssemblies = typeof(LocalDiskSettingsStorageBackend).Assembly
            .GetReferencedAssemblies()
            .Select(assemblyName => assemblyName.Name ?? string.Empty)
            .ToList();

        await Assert.That(referencedAssemblies.Any(name => name.Contains("Revit", StringComparison.OrdinalIgnoreCase)))
            .IsFalse();
    }

    [Test]
    public async Task Shared_storage_validate_matches_save_failure_for_invalid_include_root() {
        using var sandbox = new TempDir("shared-storage-validate-invalid-include-root");
        var documentId = new RuntimeSettingsDocumentId(SharedStorageModuleKey, "profiles", "profile-a");
        var sharedBackend = new LocalDiskSettingsStorageBackend(
            sandbox.Path,
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
            CreateSharedStorageModuleDefinitions()
        );
        var rawContent =
            """
            {
              "Items": [
                {
                  "$include": "@local/_not-allowed/item-a"
                }
              ]
            }
            """;

        var validation = await sharedBackend.ValidateAsync(new RuntimeValidateSettingsDocumentRequest(
            documentId,
            rawContent
        ));
        var save = await sharedBackend.SaveAsync(new RuntimeSaveSettingsDocumentRequest(documentId, rawContent));

        await Assert.That(validation.IsValid).IsFalse();
        await Assert.That(save.Validation.Issues.Select(issue => issue.Code))
            .IsEquivalentTo(validation.Issues.Select(issue => issue.Code));
    }

    [Test]
    public async Task Shared_runtime_revit_assembly_no_longer_references_host_contracts() {
        var referencedAssemblies = typeof(SettingsModuleRegistry).Assembly
            .GetReferencedAssemblies()
            .Select(assemblyName => assemblyName.Name ?? string.Empty)
            .ToList();

        await Assert.That(referencedAssemblies).DoesNotContain("Pe.Host.Contracts");
    }

    [Test]
    public async Task Host_project_file_does_not_reference_Pe_Global() {
        var projectFile = ReadRepoFile("source/Pe.Host/Pe.Host.csproj");

        await Assert.That(projectFile).DoesNotContain("Pe.Global");
    }

    [Test]
    public async Task Settings_catalog_revit_project_file_does_not_reference_Pe_Global() {
        var projectFile = ReadRepoFile("source/Pe.SettingsCatalog.Revit/Pe.SettingsCatalog.Revit.csproj");

        await Assert.That(projectFile).DoesNotContain("Pe.Global");
    }

    [Test]
    public async Task Legacy_global_schema_provider_folder_contains_no_storage_runtime_namespaces() {
        var providerDirectory = Path.Combine(
            GetRepoRoot(),
            "source",
            "Pe.Global",
            "Services",
            "Storage",
            "Core",
            "Json",
            "SchemaProviders"
        );
        if (!Directory.Exists(providerDirectory)) {
            await Assert.That(true).IsTrue();
            return;
        }

        var sourceFiles = Directory.EnumerateFiles(providerDirectory, "*.cs", SearchOption.AllDirectories)
            .Select(File.ReadAllText)
            .ToList();

        await Assert.That(sourceFiles)
            .DoesNotContain(content => content.Contains("namespace Pe.StorageRuntime", StringComparison.Ordinal));
    }

    [Test]
    public async Task Module_backed_settings_authoring_no_longer_uses_legacy_settings_dir_or_settings_manager() {
        var sourceFiles = EnumerateRepoSourceFiles(
                "source/Pe.App",
                "source/Pe.StorageRuntime.Revit",
                "source/Pe.SettingsCatalog.Revit"
            )
            .Select(path => new { path, content = File.ReadAllText(path) })
            .ToList();

        await Assert.That(sourceFiles)
            .DoesNotContain(file => file.content.Contains("SettingsDir()", StringComparison.Ordinal));
        await Assert.That(sourceFiles)
            .DoesNotContain(file => file.content.Contains(" SettingsManager", StringComparison.Ordinal) ||
                                    file.content.Contains("(SettingsManager", StringComparison.Ordinal) ||
                                    file.content.Contains(": SettingsManager", StringComparison.Ordinal));
    }

    [Test]
    public async Task CmdCacheParametersService_release_path_uses_storage_runtime_client() {
        var commandFile = ReadRepoFile("source/Pe.App/Commands/CmdCacheParametersService.cs");

        await Assert.That(commandFile).DoesNotContain("Pe.Global.Services.Storage.StorageClient");
    }

    private static Dictionary<string, SettingsStorageModuleDefinition> CreateSharedStorageModuleDefinitions() =>
        new(StringComparer.OrdinalIgnoreCase) {
            [SharedStorageModuleKey] = SettingsStorageModuleDefinition.CreateSingleRoot(
                "profiles",
                new SettingsStorageModuleOptions(["_shared"], [])
            )
        };

    private static void WriteComposableProfileFixture(string basePath, RuntimeSettingsDocumentId documentId) {
        var profilesRoot = ResolveProfilesRoot(basePath, documentId);
        _ = Directory.CreateDirectory(Path.Combine(profilesRoot, "_shared"));
        File.WriteAllText(
            Path.Combine(profilesRoot, "_shared", "item-a.json"),
            """
            {
              "Items": [
                {
                  "Name": "fragment-a"
                }
              ]
            }
            """
        );
        File.WriteAllText(
            Path.Combine(profilesRoot, "profile-a.json"),
            """
            {
              "Items": [
                {
                  "$include": "@local/_shared/item-a"
                }
              ]
            }
            """
        );
    }

    private static void WriteSimpleProfileFixture(string basePath, RuntimeSettingsDocumentId documentId) {
        var profilesRoot = ResolveProfilesRoot(basePath, documentId);
        _ = Directory.CreateDirectory(profilesRoot);
        File.WriteAllText(
            Path.Combine(profilesRoot, "profile-a.json"),
            """
            {
              "Name": "initial"
            }
            """
        );
    }

    private static void WriteGlobalComposableProfileFixture(string basePath, RuntimeSettingsDocumentId documentId) {
        var profilesRoot = ResolveProfilesRoot(basePath, documentId);
        var globalFragmentsRoot = Path.Combine(basePath, "Global", "fragments", "_shared");
        _ = Directory.CreateDirectory(profilesRoot);
        _ = Directory.CreateDirectory(globalFragmentsRoot);
        File.WriteAllText(
            Path.Combine(globalFragmentsRoot, "global-item.json"),
            """
            {
              "Items": [
                {
                  "Name": "global-fragment"
                }
              ]
            }
            """
        );
        File.WriteAllText(
            Path.Combine(profilesRoot, "profile-a.json"),
            """
            {
              "Items": [
                {
                  "$include": "@global/_shared/global-item"
                }
              ]
            }
            """
        );
    }

    private static string ResolveProfilesRoot(string basePath, RuntimeSettingsDocumentId documentId) =>
        Path.Combine(basePath, documentId.ModuleKey, "settings", documentId.RootKey);

    private static JsonSerializerSettings CreateSerializerSettings() {
        var settings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CamelCasePropertyNamesContractResolver()
        };
        settings.Converters.Add(new StringEnumConverter());
        return settings;
    }

    private static string GetRepoRoot() {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current != null) {
            if (File.Exists(Path.Combine(current.FullName, "Pe.Tools.slnx")))
                return current.FullName;

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate repository root.");
    }

    private static string ReadRepoFile(string relativePath) =>
        File.ReadAllText(Path.Combine(GetRepoRoot(), relativePath.Replace('/', Path.DirectorySeparatorChar)));

    private static IEnumerable<string> EnumerateRepoSourceFiles(params string[] relativeDirectories) =>
        relativeDirectories
            .Select(relativeDirectory =>
                Path.Combine(GetRepoRoot(), relativeDirectory.Replace('/', Path.DirectorySeparatorChar)))
            .Where(Directory.Exists)
            .SelectMany(directory => Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
            .Where(path => !path.Contains("\\bin\\", StringComparison.OrdinalIgnoreCase))
            .Where(path => !path.Contains("\\obj\\", StringComparison.OrdinalIgnoreCase));

    private sealed class TempDir : IDisposable {
        public TempDir(string prefix) {
            this.Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"{prefix}-{Guid.NewGuid():N}");
            _ = Directory.CreateDirectory(this.Path);
        }

        public string Path { get; }

        public void Dispose() {
            try {
                Directory.Delete(this.Path, true);
            } catch {
                // ignore cleanup failures in tests
            }
        }
    }

    private sealed class SharedStorageSpikeProofModule : SettingsModuleBase<SharedStorageSpikeProofSettings> {
        public SharedStorageSpikeProofModule() : base(SharedStorageModuleKey, "profiles") { }
    }

    private sealed class SharedStorageSpikeProofSettings {
        [Includable("shared")] public List<SharedStorageSpikeProofItem> Items { get; init; } = [];
    }

    private sealed class SharedStorageSpikeProofItem {
        public string Name { get; init; } = string.Empty;
    }

    private sealed class SimpleNamedSettings {
        public string Name { get; init; } = string.Empty;
    }

    private sealed class ThrowingFieldOptionsTestSettings {
        public string Value { get; init; } = string.Empty;
    }

    private sealed class ThrowingFieldOptionsTestSettingsDefinition
        : SettingsSchemaDefinition<ThrowingFieldOptionsTestSettings> {
        public override void Configure(ISettingsSchemaBuilder<ThrowingFieldOptionsTestSettings> builder) {
            builder.Property(item => item.Value, property => property.UseFieldOptions<ThrowingFieldOptionsSource>());
        }
    }

    private sealed class ThrowingFieldOptionsSource : IFieldOptionsSource {
        public FieldOptionsDescriptor Describe() => new(
            nameof(ThrowingFieldOptionsSource),
            SettingsOptionsResolverKind.Remote,
            null,
            SettingsOptionsMode.Suggestion,
            true,
            [],
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
        );

        public ValueTask<IReadOnlyList<Pe.StorageRuntime.Json.FieldOptions.FieldOptionItem>> GetOptionsAsync(
            FieldOptionsExecutionContext context,
            CancellationToken cancellationToken = default
        ) => throw new InvalidOperationException("boom");
    }

    private sealed class TestHostSettingsModuleCatalog(IReadOnlyList<SettingsSchemaRegistration> modules)
        : IHostSettingsModuleCatalog {
        private readonly IReadOnlyList<SettingsSchemaRegistration> _modules = modules;
        private readonly IReadOnlyDictionary<string, SettingsSchemaRegistration> _modulesByKey = modules.ToDictionary(
            module => module.ModuleKey,
            StringComparer.OrdinalIgnoreCase
        );

        public IReadOnlyList<SettingsSchemaRegistration> GetModules() => this._modules;

        public IReadOnlyList<HostSettingsModuleDescriptor> GetTransportDescriptors() =>
            this._modules.Select(module => new HostSettingsModuleDescriptor(module.ModuleKey, module.DefaultRootKey))
                .ToList();

        public IReadOnlyDictionary<string, SettingsStorageModuleDefinition> GetStorageDefinitions() =>
            this._modules.ToDictionary(
                module => module.ModuleKey,
                module => SettingsStorageModuleDefinition.CreateSingleRoot(
                    module.DefaultRootKey,
                    module.StorageOptions
                ),
                StringComparer.OrdinalIgnoreCase
            );

        public Pe.Host.Contracts.SettingsWorkspacesData GetWorkspaces() => new([]);

        public bool TryGetModule(string moduleKey, out SettingsSchemaRegistration module) =>
            this._modulesByKey.TryGetValue(moduleKey, out module!);
    }
}
