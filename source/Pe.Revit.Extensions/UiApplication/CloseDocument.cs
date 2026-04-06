// using Autodesk.Revit.UI;
// using Autodesk.Revit.UI.Events;
// using UIFramework;
//
// namespace Pe.Revit.Extensions.UiApplication;
// //TODO: Look into these members later too!!!!!!!!!!!!!!!!!
// // UIFrameworkServices.ManageViewsService.ActivateFrame();
// // UIFrameworkServices.ViewSwitchingService.outputViewSwitchingOrder();
//
// // UIFramework.DocSwitchManager.
// // UIFramework.TabSwitchAction.
//
// /// <summary>
// ///     Provides extension methods for closing UI documents in the Revit application.
// ///     From: https://gist.github.com/ricaun/ff6814faf407ee044b93ee8e787f628c
// /// </summary>
// public static class UIDocumentCloseExtension {
//     /// <summary>
//     ///     Closes all open UI documents in the Revit application.
//     /// </summary>
//     /// <param name="uiapp">The UIApplication instance.</param>
//     /// <param name="saveModified">Indicates whether to save modified documents.</param>
//     public static void CloseAllUIDocument(this UIApplication uiapp, bool saveModified = false) {
//         using (new DialogBoxShowingForceResultYesNo(uiapp, saveModified)) {
//             foreach (var frameControl in MainWindow.getMainWnd().getAllViews())
//                 frameControl.closeWindow();
//         }
//     }
//
//     /// <summary>
//     ///     Closes the active UI document in the Revit application.
//     /// </summary>
//     /// <param name="uiapp">The UIApplication instance.</param>
//     /// <param name="saveModified">Indicates whether to save the modified document.</param>
//     public static void CloseActiveUIDocument(this UIApplication uiapp, bool saveModified = false) {
//         var frameManager = MainWindow.getMainWnd().frameManager;
//         var activeFrameControl = frameManager.onGetActiveFrame();
//         if (activeFrameControl is null) return;
//
//         var activeFrameHost = activeFrameControl.Content as MFCMDIFrameHost;
//         var activeDocument = activeFrameHost.document;
//
//         var allViews = frameManager.getAllMDIFrames();
//         using (new DialogBoxShowingForceResultYesNo(uiapp, saveModified)) {
//             foreach (var frameControl in allViews) {
//                 var frameHost = frameControl.Content as MFCMDIFrameHost;
//                 if (frameHost.document == activeDocument) frameControl.closeWindow();
//             }
//         }
//     }
//
//     /// <summary>
//     ///     Helper class to force a specific result for dialog boxes shown in the Revit application.
//     /// </summary>
//     public class DialogBoxShowingForceResultYesNo : IDisposable {
//         private readonly bool resultYes;
//         private readonly UIApplication uiapp;
//
//         /// <summary>
//         ///     Initializes a new instance of the <see cref="DialogBoxShowingForceResultYesNo" /> class.
//         /// </summary>
//         /// <param name="uiapp">The UIApplication instance.</param>
//         /// <param name="resultYes">Indicates whether to force a 'Yes' result for dialog boxes.</param>
//         public DialogBoxShowingForceResultYesNo(UIApplication uiapp, bool resultYes) {
//             this.uiapp = uiapp;
//             this.resultYes = resultYes;
//             uiapp.DialogBoxShowing += this.OnDialogBoxShowing;
//         }
//
//         /// <summary>
//         ///     Disposes the instance and unsubscribes from the DialogBoxShowing event.
//         /// </summary>
//         public void Dispose() => this.uiapp.DialogBoxShowing -= this.OnDialogBoxShowing;
//
//         /// <summary>
//         ///     Event handler for the DialogBoxShowing event.
//         /// </summary>
//         /// <param name="sender">The event sender.</param>
//         /// <param name="e">The event arguments.</param>
//         private void OnDialogBoxShowing(object sender, DialogBoxShowingEventArgs e) {
//             // var uiapp = sender as UIApplication;
//             var result = this.resultYes ? TaskDialogResult.Yes : TaskDialogResult.No;
//             _ = e.OverrideResult((int)result);
//         }
//     }
// }