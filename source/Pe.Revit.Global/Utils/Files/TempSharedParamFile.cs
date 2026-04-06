using Autodesk.Revit.ApplicationServices;

namespace Pe.Revit.Global.Utils.Files;

/// <summary>
///     Wrapper for temporary shared parameter files that automatically cleans up on disposal.
///     Use with 'using' statement for automatic file cleanup.
///     Implicitly converts to DefinitionGroup for direct usage.
/// </summary>
public class TempSharedParamFile : IDisposable {
    public TempSharedParamFile(Document doc) {
        this.App = doc.Application;
        this.OriginalFileName = this.App.SharedParametersFilename;

        var tempSharedParamFile = Path.GetTempFileName() + ".txt";
        using (File.Create(tempSharedParamFile)) { } // Create empty file

        this.App.SharedParametersFilename = tempSharedParamFile;

        this.DefinitionFile = this.App.OpenSharedParameterFile();
    }

    public DefinitionFile DefinitionFile { get; }
    public DefinitionGroup TempGroup => this.DefinitionFile.Groups.get_Item("TempGroup") ?? this.DefinitionFile.Groups.Create("TempGroup");
    public string TempFileName => this.DefinitionFile.Filename;
    public string OriginalFileName { get; }
    private Application App { get; }

    public void Dispose() {
        try {
            // Restore original shared parameters file setting first
            this.App.SharedParametersFilename = this.OriginalFileName;
        } catch {
            Console.WriteLine("Failed to restore original SharedParametersFilename.");
        }

        try {
            if (!string.IsNullOrWhiteSpace(this.TempFileName) && File.Exists(this.TempFileName))
                File.Delete(this.TempFileName);
        } catch {
            Console.WriteLine("Failed to delete temporary shared param file.");
        }
    }
}