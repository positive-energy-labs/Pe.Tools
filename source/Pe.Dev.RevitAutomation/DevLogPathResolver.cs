using Pe.Shared.Product;

namespace Pe.Dev.RevitAutomation;

public static class DevLogPathResolver {
    public static string HostLogPath => ProductRuntimeLayout.ForCurrentUser().Logs.HostLogPath;

    public static string RevitAppLogPath => ProductRuntimeLayout.ForCurrentUser().Logs.RevitAppLogPath;
}
