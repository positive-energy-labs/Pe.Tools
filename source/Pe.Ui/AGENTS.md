---
alwaysApply: true
---

# Agent Standards (MUST READ)

Revit is single threaded and thus forces UI to be as well. The threading and
async model imposed by Revit should be very carefully considered when writing
WPF code.

---

## LIVING MEMORY (update as needed to avoid common mistakes and bad assumptions)

nint UIControlledApplication.MainWindowHandle { get; } Get the handle of the
Revit main window.

Returns the main window handle of the Revit application. This handle should be
used when displaying modal dialogs and message windows to insure that they are
properly parented. This property replaces
System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle property, which
is no longer a reliable method of retrieving the main window handle starting
with Revit 2019.
