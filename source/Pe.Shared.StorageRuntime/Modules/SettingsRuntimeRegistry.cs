namespace Pe.Shared.StorageRuntime.Modules;

public sealed class SettingsRuntimeRegistry {
    private readonly Dictionary<(string ModuleKey, string RootKey), ISettingsRootBinding> _bindings =
        new();

    private readonly Dictionary<string, StructuralSettingsModuleDescriptor> _modules =
        new(StringComparer.OrdinalIgnoreCase);

    public void RegisterModule(StructuralSettingsModuleDescriptor module) {
        if (module == null)
            throw new ArgumentNullException(nameof(module));

        if (this._modules.TryGetValue(module.ModuleKey, out var existing)) {
            if (existing != module) {
                throw new InvalidOperationException(
                    $"Module '{module.ModuleKey}' is already registered with a different structural descriptor."
                );
            }

            return;
        }

        this._modules[module.ModuleKey] = module;
    }

    public void RegisterModules(IEnumerable<StructuralSettingsModuleDescriptor> modules) {
        if (modules == null)
            return;

        foreach (var module in modules)
            this.RegisterModule(module);
    }

    public void RegisterRootBinding(ISettingsRootBinding binding) {
        if (binding == null)
            throw new ArgumentNullException(nameof(binding));

        this.RegisterModule(binding.Module);

        if (!binding.Module.Roots.Any(root =>
                string.Equals(root.RootKey, binding.RootKey, StringComparison.OrdinalIgnoreCase))) {
            throw new InvalidOperationException(
                $"Root '{binding.RootKey}' is not declared on structural module '{binding.Module.ModuleKey}'."
            );
        }

        var key = (binding.Module.ModuleKey, binding.RootKey);
        if (this._bindings.TryGetValue(key, out var existing)) {
            if (existing.SettingsType != binding.SettingsType) {
                throw new InvalidOperationException(
                    $"Root binding '{binding.Module.ModuleKey}/{binding.RootKey}' is already registered with a different settings type."
                );
            }

            return;
        }

        this._bindings[key] = binding;
    }

    public void RegisterRootBindings(IEnumerable<ISettingsRootBinding> bindings) {
        if (bindings == null)
            return;

        foreach (var binding in bindings)
            this.RegisterRootBinding(binding);
    }

    public IReadOnlyList<StructuralSettingsModuleDescriptor> GetModules() =>
        this._modules.Values.ToList();

    /// <summary>The binding a spec's `$schema` URL names; absolute or host-relative URLs both resolve.</summary>
    public ISettingsRootBinding ResolveSchemaUrl(string schemaUrl) {
        var path = Uri.UnescapeDataString(Uri.TryCreate(schemaUrl, UriKind.Absolute, out var uri) ? uri.AbsolutePath : schemaUrl);
        return this._bindings.Values.FirstOrDefault(binding =>
                   path.EndsWith(SettingsSchemaUrl.Path(binding), StringComparison.OrdinalIgnoreCase))
               ?? throw new ArgumentException($"No settings library serves $schema '{schemaUrl}'.");
    }
}

/// <summary>The `$schema` URL shape: `/schemas/settings/{module}/{root}.json`. A spec's only identity claim.</summary>
public static class SettingsSchemaUrl {
    public static string Path(ISettingsRootBinding binding) =>
        $"/schemas/settings/{binding.Module.ModuleKey}/{binding.RootKey}.json";
}
