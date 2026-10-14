using System.Runtime.InteropServices;

namespace Pe.Host.Tray;

/**
 * The tray process names itself to Windows once: one AppUserModelID for the installed tray and one per
 * dev checkout, so the taskbar, Start and notifications never merge it with the PWA window Edge owns
 * or with another checkout's dev tray.
 */
internal static class TrayIdentity {
    internal static string AppUserModelId(TrayLaunch launch) => launch.IsDev
        ? "PositiveEnergy.PeTools.Tray.Dev." + launch.ProfileKey["dev-".Length..]
        : "PositiveEnergy.PeTools.Tray";

    /** Before any window exists, or the shell has already grouped the process under its exe path. */
    internal static void Apply(TrayLaunch launch) => SetCurrentProcessExplicitAppUserModelID(AppUserModelId(launch));

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
