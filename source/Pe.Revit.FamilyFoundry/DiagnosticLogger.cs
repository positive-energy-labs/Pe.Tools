using Autodesk.Revit.ApplicationServices;
using System.Diagnostics;
using System.Text;

namespace Pe.Revit.FamilyFoundry;

/// <summary>
///     Diagnostic logger for debugging parameter creation issues.
///     Thread-safe, writes to a file in the output directory.
/// </summary>
public class DiagnosticLogger : IDisposable {
    private readonly object _lock = new();
    private readonly string _logFilePath;
    private StreamWriter _writer;

    public DiagnosticLogger(string outputDirectory, string familyName) {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var sanitizedFamilyName = SanitizeFileName(familyName);
        this._logFilePath = Path.Combine(outputDirectory, $"diagnostic_{sanitizedFamilyName}_{timestamp}.log");

        _ = Directory.CreateDirectory(outputDirectory);
        this._writer = new StreamWriter(this._logFilePath, true, Encoding.UTF8);
        this.Log("=== Diagnostic Log Started ===");
        this.Log($"Family: {familyName}");
        this.Log($"Timestamp: {timestamp}");
        this.Log("");
    }

    public void Dispose() {
        lock (this._lock) {
            this.Log("");
            this.Log("=== Diagnostic Log Ended ===");
            this._writer?.Flush();
            this._writer?.Dispose();
            this._writer = null;
        }
    }

    public void Log(string message) {
        lock (this._lock) {
            var timestamp = DateTime.Now.ToString("HH:mm:ss.fff");
            this._writer?.WriteLine($"[{timestamp}] {message}");
            this._writer?.Flush();
        }
    }

    public void LogSection(string sectionName) {
        this.Log("");
        this.Log($"========== {sectionName} ==========");
    }

    public void LogException(string context, Exception ex) {
        this.Log($"EXCEPTION in {context}:");
        this.Log($"  Type: {ex.GetType().FullName}");
        this.Log($"  Message: {ex.ToStringDemystified()}");

        if (ex.StackTrace != null)
            this.Log($"  StackTrace: {ex.StackTrace}");

        if (ex.InnerException != null) {
            this.Log($"  Inner Exception: {ex.InnerException.GetType().FullName}");
            this.Log($"  Inner Message: {ex.InnerException.Message}");
        }
    }

    public void LogParameterAttempt(
        string paramName,
        Guid guid,
        string specTypeId,
        string groupTypeId,
        bool isInstance,
        string familyCategory
    ) {
        this.LogSection($"Parameter Attempt: {paramName}");
        this.Log($"  GUID: {guid}");
        this.Log($"  SpecTypeId: {specTypeId}");
        this.Log($"  GroupTypeId: {groupTypeId}");
        this.Log($"  IsInstance: {isInstance}");
        this.Log($"  FamilyCategory: {familyCategory}");
    }

    public void LogSharedParamFileState(Application app, string context) {
        this.LogSection($"SharedParametersFile State - {context}");

        try {
            var filename = app.SharedParametersFilename;
            this.Log($"  SharedParametersFilename: {filename ?? "(null)"}");

            if (!string.IsNullOrEmpty(filename)) {
                var exists = File.Exists(filename);
                this.Log($"  File Exists: {exists}");

                if (exists) {
                    var fileInfo = new FileInfo(filename);
                    this.Log($"  File Size: {fileInfo.Length} bytes");
                    this.Log($"  Last Modified: {fileInfo.LastWriteTime}");
                }
            }
        } catch (Exception ex) {
            this.Log($"  ERROR reading SharedParametersFilename: {ex.ToStringDemystified()}");
        }
    }

    public void LogExternalDefinitionState(ExternalDefinition extDef) {
        try {
            this.Log("  ExternalDefinition State:");
            this.Log($"    Name: {extDef.Name}");

            try {
                this.Log($"    GUID: {extDef.GUID}");
            } catch (Exception ex) {
                this.Log($"    GUID: ERROR - {ex.ToStringDemystified()}");
            }

            try {
                var paramType = extDef.GetDataType();
                this.Log($"    ParameterType: {paramType?.TypeId ?? "(null)"}");
            } catch (Exception ex) {
                this.Log($"    ParameterType: ERROR - {ex.ToStringDemystified()}");
            }

            try {
                var ownerGroup = extDef.OwnerGroup;
                this.Log($"    OwnerGroup: {ownerGroup?.Name ?? "(null)"}");

                // Note: DefinitionFile is not directly accessible from DefinitionGroup in Revit API
                // It's accessed through Application.OpenSharedParameterFile()
                // We log this limitation for diagnostic purposes
                if (ownerGroup != null) this.Log("    OwnerGroup exists (DefinitionFile access not available via API)");
            } catch (Exception ex) {
                this.Log($"    OwnerGroup: ERROR - {ex.ToStringDemystified()}");
            }
        } catch (Exception ex) {
            this.Log($"  ERROR examining ExternalDefinition: {ex.ToStringDemystified()}");
        }
    }

    public void LogTempFileCreation(string tempFilePath, string originalFilename) {
        this.LogSection("TempSharedParamFile Created");
        this.Log($"  Temp File Path: {tempFilePath}");
        this.Log($"  Original SharedParametersFilename: {originalFilename ?? "(null)"}");

        if (!string.IsNullOrEmpty(tempFilePath)) {
            var exists = File.Exists(tempFilePath);
            this.Log($"  Temp File Exists: {exists}");
        }
    }

    public void LogTempFileDisposal(string tempFilePath, bool stillExists) {
        this.LogSection("TempSharedParamFile Disposed");
        this.Log($"  Temp File Path: {tempFilePath}");
        this.Log($"  File Still Exists After Disposal: {stillExists}");
    }

    private static string SanitizeFileName(string fileName) {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(fileName.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        return sanitized.Length > 50 ? sanitized.Substring(0, 50) : sanitized;
    }
}