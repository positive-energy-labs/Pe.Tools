using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using System.Runtime.CompilerServices;

namespace Pe.StorageRuntime.Revit.Core.Json;

internal static class RevitJsonSchemaModuleInitializer {
    [ModuleInitializer]
    internal static void RegisterBindings() => RevitTypeRegistry.Initialize();
}
