using Pe.Shared.Product;

namespace Pe.Dev.RevitAutomation;

public static class DevLogPathResolver {
    public static string HostLogPath => ProductRuntimeLayout.Current.Logs.HostLogPath;

    public static string RevitAppLogPath => ProductRuntimeLayout.Current.Logs.RevitAppLogPath;
}
