using Autodesk.Revit.Exceptions;
using Autodesk.Revit.UI;
using Pe.Global.Services.Document;
using System.Diagnostics;
using System.Windows;

namespace Pe.Extensions.UiApplication;

public static class OpenDocumentExtensions {
    /// <summary>
    ///     Opens and activates a view, handling cross-document navigation.
    ///     Key API behaviors discovered through testing (2025-12-08):
    ///     - Project documents (.rvt): CAN be re-opened via OpenAndActivateDocument (local and cloud)
    ///     - Family documents (.rfa opened from disk): CANNOT be re-opened - Revit throws FileNotFoundException
    ///     - Family documents via EditFamily: Have NO PathName initially - requires temp file workaround
    ///     - Family documents WITH PathName (from previous temp save): CAN be re-opened directly!
    ///     - UIDocument.ActiveView setter ONLY works on the currently active document
    ///     - UIDocument.RequestViewChange() on non-active document: THROWS "not applicable to inactive documents"
    ///     - OpenAndActivateDocument(ModelPath) for cloud docs: SLOW/FAILS without network - has timeout warning
    /// </summary>
    public static void OpenAndActivateView(this UIApplication uiApp, View targetView) {
        try {
            var targetDoc = targetView.Document;
            var targetUiDoc = new UIDocument(targetDoc);

            // CASE 1: Target document is already the active document. Use RequestViewChange for reliability.
            // (ActiveView setter doesn't stick when called from palette callbacks sometimes. Particularly for 
            // Sheets/Schedules which are already open.)
            // PERFORMANCE: This is the fast path for MRU views - ~99% of cases. No logging to minimize overhead.
            if (DocumentManager.IsDocumentActive(targetDoc)) {
                targetUiDoc.RequestViewChange(targetView);
                return;
            }

            // CASE 2: Target document is open but not active (less common, log for diagnostics)
            if (DocumentManager.IsDocumentOpen(targetDoc)) {
                Console.WriteLine($"[OpenAndActivateView] Document '{targetDoc.Title}' is open but not active");

                // For family documents, use the special family activation (saves to temp)
                // REASON: Revit throws FileNotFoundException when trying to re-open .rfa files,
                // even if the file exists on disk. Additionally, EditFamily creates documents with
                // NO PathName, so OpenAndActivateDocument cannot be used at all. Temp file is required.
                if (targetDoc.IsFamilyDocument) {
                    Console.WriteLine("[OpenAndActivateView] Target is family document, using family activation...");
                    ActivateOpenFamilyDocumentAndView(targetDoc, targetView);
                    return;
                }

                // For project documents: OpenAndActivateDocument
                // WARNING: For cloud documents, this triggers network calls and may be slow/fail offline
                var existingDocPath = DocumentManager.GetDocumentModelPath(targetDoc);
                if (existingDocPath != null) {
                    var isCloud = targetDoc.IsModelInCloud;
                    Console.WriteLine($"[OpenAndActivateView] Using OpenAndActivateDocument (isCloud={isCloud})");

                    // For cloud documents, use a timeout warning mechanism
                    if (isCloud) {
                        _ = TryOpenCloudDocumentWithTimeout(existingDocPath, targetView, 3);
                    } else {
                        // Local documents - just open directly (fast)
                        var existingDocOptions =
                            new OpenOptions { DetachFromCentralOption = DetachFromCentralOption.DoNotDetach };
                        var activatedUiDoc = uiApp.OpenAndActivateDocument(existingDocPath, existingDocOptions, false);
                        activatedUiDoc.RequestViewChange(targetView);
                    }

                    return;
                }

                Console.WriteLine("[OpenAndActivateView] No path available, cannot switch to document");
                return;
            }

            // CASE 3: Document not open - try to open it via file path (rare case, log for diagnostics)
            var newDocPath = DocumentManager.GetDocumentModelPath(targetDoc);
            if (newDocPath == null) {
                Console.WriteLine($"[OpenAndActivateView] Cannot open document '{targetDoc.Title}' - no valid path");
                return;
            }

            Console.WriteLine($"[OpenAndActivateView] Opening document from path: {newDocPath}");
            var newDocOptions = new OpenOptions { DetachFromCentralOption = DetachFromCentralOption.DoNotDetach };
            var openedUiDoc = uiApp.OpenAndActivateDocument(newDocPath, newDocOptions, false);
            openedUiDoc.RequestViewChange(targetView);
        } catch (Exception ex) {
            // Only log detailed state on error
            Console.WriteLine(DocumentManager.LogDocumentState(targetView, "OpenAndActivateView ERROR"));
            Console.WriteLine(ex.ToStringDemystified());
        }
    }

    /// <summary>
    ///     Opens and activates a family document for editing.
    ///     Logic flow:
    ///     1. If family doc is already open AND active -> do nothing (already there)
    ///     2. If family doc is already open but NOT active:
    ///     a. If it has a PathName (from previous activation) -> use OpenAndActivateDocument directly
    ///     b. If no PathName -> SaveAs to stable temp path, then OpenAndActivateDocument
    ///     3. If family doc is NOT open -> use EditFamily to open it, then activate via step 2
    ///     OPTIMIZATION: Once a family has been saved to a stable temp path, subsequent activations
    ///     skip SaveAs and use OpenAndActivateDocument directly with the existing path.
    /// </summary>
    public static void OpenAndActivateFamily(this UIApplication uiApp, Family family) {
        Console.WriteLine(DocumentManager.LogDocumentState(context: "OpenAndActivateFamily START"));

        try {
            // Check if family document is already open
            var existingFamDoc = DocumentManager.FindOpenFamilyDocument(family);

            if (existingFamDoc != null) {
                Console.WriteLine($"[OpenAndActivateFamily] Family '{family.Name}' is already open");

                // If it's already the active document, nothing to do
                if (DocumentManager.IsDocumentActive(existingFamDoc)) {
                    Console.WriteLine("[OpenAndActivateFamily] Family doc is active, nothing to do");
                    return;
                }

                // Document is open but not active - need to switch to it
                Console.WriteLine("[OpenAndActivateFamily] Family doc is open but not active, switching...");
                ActivateOpenFamilyDocument(uiApp, existingFamDoc, family.Name);
                return;
            }

            // Family document is not open - open it via EditFamily
            Console.WriteLine($"[OpenAndActivateFamily] Family '{family.Name}' is NOT open, calling EditFamily...");
            var activeDoc = DocumentManager.GetActiveDocument();
            var famDoc = activeDoc?.EditFamily(family);

            if (famDoc == null) {
                Console.WriteLine($"[OpenAndActivateFamily] EditFamily returned null for '{family.Name}'");
                return;
            }

            Console.WriteLine($"[OpenAndActivateFamily] EditFamily returned document '{famDoc.Title}'");
            Console.WriteLine(DocumentManager.LogDocumentState(context: "After EditFamily"));

            // EditFamily opens the document but does NOT activate it in the UI.
            // ShowElements is unreliable for activation.
            // The reliable approach: save to temp file and use OpenAndActivateDocument
            ActivateOpenFamilyDocument(uiApp, famDoc, family.Name);
        } catch (Exception ex) {
            Console.WriteLine(DocumentManager.LogDocumentState(context: "OpenAndActivateFamily ERROR"));
            Console.WriteLine(ex.ToStringDemystified());
        }
    }

    /// <summary>
    ///     Activates an already-open family document.
    ///     OPTIMIZATION: If the family already has a PathName (from a previous temp save),
    ///     OpenAndActivateDocument works directly without needing SaveAs again.
    ///     Only falls back to SaveAs when the document has no PathName (fresh EditFamily).
    /// </summary>
    private static void ActivateOpenFamilyDocument(UIApplication uiApp, Document famDoc, string familyName) {
        // OPTIMIZATION: If family already has a PathName, try direct activation first
        if (!string.IsNullOrEmpty(famDoc.PathName)) {
            Console.WriteLine(
                $"[ActivateOpenFamilyDocument] Family has PathName, trying direct activation: {famDoc.PathName}");
            try {
                _ = uiApp.OpenAndActivateDocument(famDoc.PathName);
                Console.WriteLine("[ActivateOpenFamilyDocument] Direct activation succeeded!");
                return;
            } catch (Exception ex) {
                Console.WriteLine($"[ActivateOpenFamilyDocument] Direct activation failed: {ex.Message}");
                Console.WriteLine("[ActivateOpenFamilyDocument] Falling back to SaveAs workaround...");
            }
        }

        // No PathName or direct activation failed - use SaveAs to stable temp path
        var tempPath = SaveFamilyToStableTempFile(famDoc, familyName);
        Console.WriteLine("[ActivateOpenFamilyDocument] Opening from temp path...");
        _ = uiApp.OpenAndActivateDocument(tempPath);
    }

    /// <summary>
    ///     Activates an already-open family document and switches to a specific view.
    ///     OPTIMIZATION: If the family already has a PathName, skips SaveAs.
    /// </summary>
    private static void ActivateOpenFamilyDocumentAndView(Document famDoc, View targetView) {
        UIDocument activatedUiDoc;
        var uiApp = DocumentManager.uiapp;

        // OPTIMIZATION: If family already has a PathName, try direct activation first
        if (!string.IsNullOrEmpty(famDoc.PathName)) {
            Console.WriteLine(
                $"[ActivateOpenFamilyDocumentAndView] Family has PathName, trying direct activation: {famDoc.PathName}");
            try {
                activatedUiDoc = uiApp.OpenAndActivateDocument(famDoc.PathName);
                Console.WriteLine("[ActivateOpenFamilyDocumentAndView] Direct activation succeeded!");
            } catch (Exception ex) {
                Console.WriteLine($"[ActivateOpenFamilyDocumentAndView] Direct activation failed: {ex.Message}");
                Console.WriteLine("[ActivateOpenFamilyDocumentAndView] Falling back to SaveAs workaround...");
                var tempPath = SaveFamilyToStableTempFile(famDoc, famDoc.Title);
                activatedUiDoc = uiApp.OpenAndActivateDocument(tempPath);
            }
        } else {
            // No PathName - use SaveAs to stable temp path
            var tempPath = SaveFamilyToStableTempFile(famDoc, famDoc.Title);
            Console.WriteLine("[ActivateOpenFamilyDocumentAndView] Opening from temp path...");
            activatedUiDoc = uiApp.OpenAndActivateDocument(tempPath);
        }

        // Now set the view since we're in the active document
        // Note: The targetView reference may be stale after SaveAs, so find the view by name
        var viewByName = new FilteredElementCollector(activatedUiDoc.Document)
            .OfClass(typeof(View))
            .Cast<View>()
            .FirstOrDefault(v => v.Name == targetView.Name && v.ViewType == targetView.ViewType);

        if (viewByName != null) {
            Console.WriteLine($"[ActivateOpenFamilyDocumentAndView] Using RequestViewChange to '{viewByName.Name}'");
            activatedUiDoc.RequestViewChange(viewByName);
        } else
            Console.WriteLine($"[ActivateOpenFamilyDocumentAndView] Could not find matching view '{targetView.Name}'");
    }

    /// <summary>
    ///     Saves a family document to a STABLE temp file path and returns the path.
    ///     Uses consistent naming to avoid path churn and preserve MRU tracking.
    /// </summary>
    private static string SaveFamilyToStableTempFile(Document famDoc, string familyName) {
        // Use a stable directory (no GUIDs) so the same family always gets the same path
        var tempDir = Path.Combine(Path.GetTempPath(), "Pe.App_FamilyCache");
        if (!Directory.Exists(tempDir))
            _ = Directory.CreateDirectory(tempDir);

        // Sanitize family name and ensure no double extension
        var baseName = Path.GetFileNameWithoutExtension(familyName);
        if (string.IsNullOrEmpty(baseName)) baseName = familyName;
        var safeName = SanitizeFileName(baseName);
        var tempPath = Path.Combine(tempDir, $"{safeName}.rfa");

        Console.WriteLine($"[SaveFamilyToStableTempFile] Saving to stable temp path: {tempPath}");
        famDoc.SaveAs(tempPath, new SaveAsOptions { OverwriteExistingFile = true });

        return tempPath;
    }

    /// <summary>
    ///     Sanitizes a string for use as a filename by removing invalid characters.
    /// </summary>
    private static string SanitizeFileName(string name) {
        var invalid = Path.GetInvalidFileNameChars();
        return string.Join("_", name.Split(invalid, StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>
    ///     Attempts to open a cloud document with a timeout warning mechanism.
    ///     Since Revit's API is synchronous and can't be cancelled, we:
    ///     1. Start a background timer that shows a warning dialog after timeoutSeconds
    ///     2. Make the blocking API call
    ///     3. If it completes quickly, cancel the timer
    ///     4. If it fails with a network error, show a friendly error
    ///     Returns true if successful, false if failed (error shown to user).
    /// </summary>
    private static bool TryOpenCloudDocumentWithTimeout(
        ModelPath modelPath,
        View targetView,
        int timeoutSeconds
    ) {
        var sw = Stopwatch.StartNew();
        var timerFired = false;
        var uiApp = DocumentManager.uiapp;
        var timeoutTimer = new Timer(_ => {
            timerFired = true;
            Console.WriteLine($"[TryOpenCloudDocument] Timeout reached after {timeoutSeconds}s, showing warning...");

            // Show warning on UI thread via WPF Dispatcher
            _ = Application.Current?.Dispatcher?.BeginInvoke(() =>
                MessageBox.Show(
                    "The cloud model is taking a long time to respond.\n\n" +
                    "This usually means there's a network connectivity issue.\n" +
                    "The operation will continue, but you may need to wait or check your connection.",
                    "Cloud Model - Slow Response",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning));
        }, null, timeoutSeconds * 1000, Timeout.Infinite);

        try {
            Console.WriteLine(
                $"[TryOpenCloudDocument] Starting cloud document activation (timeout={timeoutSeconds}s)...");

            // Make the blocking API call
            var openOptions = new OpenOptions { DetachFromCentralOption = DetachFromCentralOption.DoNotDetach };
            var activatedUiDoc = uiApp.OpenAndActivateDocument(modelPath, openOptions, false);

            Console.WriteLine($"[TryOpenCloudDocument] OpenAndActivateDocument completed in {sw.ElapsedMilliseconds}ms");

            // Success - switch to the target view
            activatedUiDoc.RequestViewChange(targetView);
            return true;
        } catch (RevitServerCommunicationException ex) {
            Console.WriteLine($"[TryOpenCloudDocument] Network error after {sw.ElapsedMilliseconds}ms: {ex.Message}");

            // Show friendly error dialog
            _ = TaskDialog.Show(
                "Cloud Model Unavailable",
                "Cannot switch to the cloud model - the server could not be reached.\n\n" +
                "Please check your network connection and try again.\n\n" +
                "Click on the document tab directly to switch without network access.");
            return false;
        } catch (Exception ex) {
            Console.WriteLine($"[TryOpenCloudDocument] Unexpected error after {sw.ElapsedMilliseconds}ms: {ex.Message}");
            Console.WriteLine(ex.ToStringDemystified());

            _ = TaskDialog.Show(
                "Error Switching Documents",
                $"An error occurred while switching to the cloud model:\n\n{ex.Message}");
            return false;
        } finally {
            // Always dispose the timer
            timeoutTimer?.Dispose();

            if (timerFired) {
                Console.WriteLine(
                    $"[TryOpenCloudDocument] Operation completed after timeout warning (total: {sw.ElapsedMilliseconds}ms)");
            }
        }
    }
}