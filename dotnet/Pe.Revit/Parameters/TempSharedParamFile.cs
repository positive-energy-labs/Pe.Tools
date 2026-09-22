using Autodesk.Revit.ApplicationServices;

namespace Pe.Revit.Parameters;

/// <summary>
///     Keeps the temporary shared parameter file active until disposal, including native add,
///     replace and bind calls using its definitions. Dispose nested scopes in reverse order.
/// </summary>
public class TempSharedParamFile : IDisposable {
    public TempSharedParamFile(Document doc) {
        this.App = doc.Application;
        this.OriginalFileName = this.App.SharedParametersFilename;

        var tempSharedParamFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N") + ".txt");
        using (File.Create(tempSharedParamFile)) { } // Create empty file

        try {
            this.App.SharedParametersFilename = tempSharedParamFile;
            this.DefinitionFile = this.App.OpenSharedParameterFile()
                ?? throw new InvalidOperationException("Revit could not open the temporary shared parameter file.");
        } catch {
            this.App.SharedParametersFilename = this.OriginalFileName;
            File.Delete(tempSharedParamFile);
            throw;
        }
    }

    public DefinitionFile DefinitionFile { get; }

    public DefinitionGroup TempGroup => this.DefinitionFile.Groups.get_Item("TempGroup") ??
                                        this.DefinitionFile.Groups.Create("TempGroup");

    public string TempFileName => this.DefinitionFile.Filename;
    public string OriginalFileName { get; }
    private Application App { get; }

    public void Dispose() {
        this.App.SharedParametersFilename = this.OriginalFileName;
        try {
            if (!string.IsNullOrWhiteSpace(this.TempFileName) && File.Exists(this.TempFileName))
                File.Delete(this.TempFileName);
        } catch {
            Console.WriteLine("Failed to delete temporary shared param file.");
        }
    }
}
