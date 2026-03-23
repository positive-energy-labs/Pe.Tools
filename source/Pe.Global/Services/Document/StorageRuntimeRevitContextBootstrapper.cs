using Pe.StorageRuntime.Revit.Context;
using System.Runtime.CompilerServices;

namespace Pe.Global.Services.Document;

internal static class StorageRuntimeRevitContextBootstrapper {
    [ModuleInitializer]
    internal static void Register() =>
        SettingsDocumentContextAccessorRegistry.Current = new DocumentManagerRevitContextAccessor();
}
