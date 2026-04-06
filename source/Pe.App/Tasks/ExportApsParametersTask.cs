using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.Revit.Global.Services.Aps.Models;
using Pe.Shared.StorageRuntime;
using System.IO;

namespace Pe.App.Tasks;

/// <summary>
///     Exports Autodesk Parameters Service parameters to a shared parameter file.
///     Creates a persistent shared parameter file containing all parameters from the cached APS collection.
/// </summary>
public sealed class ExportApsParametersTask : ITask {
    public string Name => "Export APS Parameters to Shared Param File";

    public string? Description =>
        "Exports all Autodesk Parameters Service parameters to a shared parameter file (.txt)";

    public string? Category => "Export";

    public async Task ExecuteAsync(UIApplication uiApp) {
        try {
            // Load cached APS parameters
            const string cacheFilename = "parameters-service-cache";
            var globalState = StorageClient.Default.Global().State();
            var apsParamsCache = globalState.Json<ParametersApi.Parameters>(cacheFilename);
            var cacheFilePath = globalState.ResolveSafeRelativeJsonPath(cacheFilename);

            if (!File.Exists(cacheFilePath)) {
                Console.WriteLine(
                    "❌ APS parameters cache not found. Run 'Cache Params Svc' command first to download parameters.");
                return;
            }

            var cachedParams = apsParamsCache.Read();
            if (cachedParams?.Results == null || cachedParams.Results.Count == 0) {
                Console.WriteLine("❌ No parameters found in cache");
                return;
            }

            // Filter out archived parameters
            var activeParams = cachedParams.Results.Where(p => !p.IsArchived).ToList();
            if (activeParams.Count == 0) {
                Console.WriteLine("❌ No active (non-archived) parameters found in cache");
                return;
            }

            Console.WriteLine($"Found {activeParams.Count} active parameters to export");

            // Get output path
            var output = this.GetOutput();
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
            var outputFileName = $"APS_Parameters_{timestamp}.txt";
            var outputPath = Path.Combine(output.DirectoryPath, outputFileName);

            // Create shared parameter file
            var app = uiApp.Application;
            var originalSharedParamFile = app.SharedParametersFilename;

            try {
                // Set to new file path
                app.SharedParametersFilename = outputPath;

                // Open/create the shared parameter file
                var defFile = app.OpenSharedParameterFile();
                if (defFile == null) {
                    // File doesn't exist, create it
                    File.WriteAllText(outputPath, string.Empty);
                    defFile = app.OpenSharedParameterFile();
                }

                if (defFile == null) {
                    Console.WriteLine("❌ Failed to create shared parameter file");
                    return;
                }

                // Create or get definition group
                var groupName = "APS Parameters";
                var group = defFile.Groups.get_Item(groupName) ?? defFile.Groups.Create(groupName);

                Console.WriteLine($"Exporting parameters to group: {groupName}");

                // Add all parameters to the group
                var successCount = 0;
                var skipCount = 0;
                var errorCount = 0;

                foreach (var param in activeParams) {
                    try {
                        // Check if parameter already exists
                        var existing = group.Definitions.get_Item(param.Name);
                        if (existing != null) {
                            skipCount++;
                            continue;
                        }

                        // Get parameter download options which handles GUID and spec type
                        var downloadOpts = param.DownloadOptions;

                        // Create external definition
                        var externalDef = group.Definitions.Create(
                            new ExternalDefinitionCreationOptions(param.Name ?? "Unknown",
                                downloadOpts.GetSpecTypeId()) {
                                GUID = downloadOpts.GetGuid(),
                                Visible = downloadOpts.Visible,
                                UserModifiable = !param.ReadOnly,
                                Description = param.Description ?? string.Empty
                            });

                        if (externalDef != null)
                            successCount++;
                        else {
                            Console.WriteLine($"  ⚠ Failed to create definition: {param.Name}");
                            errorCount++;
                        }
                    } catch (Exception ex) {
                        Console.WriteLine($"  ✗ Error creating parameter '{param.Name}': {ex.Message}");
                        errorCount++;
                    }
                }

                Console.WriteLine("\n=== Export Summary ===");
                Console.WriteLine($"  ✓ Created: {successCount}");
                if (skipCount > 0)
                    Console.WriteLine($"  ⊘ Skipped (already exists): {skipCount}");
                if (errorCount > 0)
                    Console.WriteLine($"  ✗ Errors: {errorCount}");
                Console.WriteLine($"  📄 File: {outputPath}");
                Console.WriteLine("===================\n");
            } finally {
                // Restore original shared parameters file setting
                try {
                    app.SharedParametersFilename = originalSharedParamFile;
                } catch {
                    Console.WriteLine("⚠ Warning: Failed to restore original SharedParametersFilename");
                }
            }

            await Task.CompletedTask;
        } catch (Exception ex) {
            Console.WriteLine($"❌ Task failed: {ex.Message}");
            Console.WriteLine(ex.StackTrace);
        }
    }
}
