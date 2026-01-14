using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using Condition = System.Windows.Automation.Condition;
using Point = System.Windows.Point;

namespace Pe.Global.Utils;

// saving for later automations sequences
public static class Automations {
    private const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    private const uint MOUSEEVENTF_LEFTUP = 0x04;

    private const int SW_RESTORE = 9;

    [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);


    public static AutomationElement FindElementByName(string name, AutomationElement parent = null) {
        var scope = parent == null ? TreeScope.Descendants : TreeScope.Children;
        var root = parent ?? AutomationElement.RootElement;
        var condition = new PropertyCondition(AutomationElement.NameProperty, name);
        return root.FindFirst(scope, condition);
    }

    public static AutomationElement FindElementByAutomationId(string id, AutomationElement parent = null) {
        var scope = parent == null ? TreeScope.Descendants : TreeScope.Children;
        var root = parent ?? AutomationElement.RootElement;
        var condition = new PropertyCondition(AutomationElement.AutomationIdProperty, id);
        return root.FindFirst(scope, condition);
    }

    public static AutomationElement FindElement(string automationId = null,
        string name = null,
        string localizedControlType = null,
        AutomationElement parent = null) {
        var root = parent ?? AutomationElement.RootElement;
        var scope = parent == null ? TreeScope.Descendants : TreeScope.Children;
        Condition condition = null;

        if (!string.IsNullOrEmpty(automationId))
            condition = new PropertyCondition(AutomationElement.AutomationIdProperty, automationId);
        else if (!string.IsNullOrEmpty(name)) condition = new PropertyCondition(AutomationElement.NameProperty, name);

        if (!string.IsNullOrEmpty(localizedControlType)) {
            var controlTypeCondition =
                new PropertyCondition(AutomationElement.LocalizedControlTypeProperty, localizedControlType);
            condition = condition == null ? controlTypeCondition : new AndCondition(condition, controlTypeCondition);
        }

        if (condition == null) {
            Debug.WriteLine("No search criteria provided for FindElement.");
            return null;
        }

        return root.FindFirst(scope, condition);
    }

    public static async Task<bool> ClickButtonAsync(string buttonName,
        string automationId = null,
        AutomationElement parent = null) => await Task.Run(() => {
        var element = FindElement(automationId, buttonName, "button", parent);
        if (element == null) {
            Debug.WriteLine($"Button '{buttonName}' (AutomationId: '{automationId}') not found.");
            return false;
        }

        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern)) {
            (pattern as InvokePattern)?.Invoke();
            return true;
        }

        Debug.WriteLine($"Button '{buttonName}' (AutomationId: '{automationId}') does not support InvokePattern.");
        return false;
    });

    public static async Task<bool> ClickListItemByNameAsync(string itemName) => await Task.Run(() => {
        var element = FindElement(name: itemName, localizedControlType: "list item");
        if (element == null) {
            Debug.WriteLine($"List item '{itemName}' not found.");
            return false;
        }

        var rect = element.Current.BoundingRectangle;
        if (rect != Rect.Empty) {
            var clickablePoint = new Point(rect.Left + (rect.Width / 2), rect.Top + (rect.Height / 2));
            Debug.WriteLine(
                $"Simulating mouse click on list item '{itemName}' at {clickablePoint.X},{clickablePoint.Y}.");
            // this used to be System.Windows.Forms.Cursor.Position = new System.Drawing.Point((int)clickablePoint.X, (int)clickablePoint.Y);
            _ = SetCursorPos((int)clickablePoint.X, (int)clickablePoint.Y);
            mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, (uint)clickablePoint.X, (uint)clickablePoint.Y, 0,
                0);
            return true;
        }

        Debug.WriteLine($"Could not get clickable point for list item '{itemName}'.");
        return false;
    });

    public static async Task<bool> ClickListItemByAutomationIdAsync(string automationId) => await Task.Run(() => {
        var element = FindElement(automationId, localizedControlType: "list item");
        if (element == null) {
            Debug.WriteLine($"List item with AutomationId: '{automationId}' not found.");
            return false;
        }

        var rect = element.Current.BoundingRectangle;
        if (rect != Rect.Empty) {
            var clickablePoint = new Point(rect.Left + (rect.Width / 2), rect.Top + (rect.Height / 2));
            Debug.WriteLine(
                $"Simulating mouse click on list item with AutomationId: '{automationId}' at {clickablePoint.X},{clickablePoint.Y}.");
            // this used to be System.Windows.Forms.Cursor.Position = new System.Drawing.Point((int)clickablePoint.X, (int)clickablePoint.Y);
            _ = SetCursorPos((int)clickablePoint.X, (int)clickablePoint.Y);
            mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, (uint)clickablePoint.X, (uint)clickablePoint.Y, 0,
                0);
            return true;
        }

        Debug.WriteLine($"Could not get clickable point for list item with AutomationId: '{automationId}'.");
        return false;
    });

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    /// <summary>
    ///     Brings the specified window to the foreground and activates it.
    ///     <code>
    /// var revitWindow = Process.GetCurrentProcess().MainWindowTitle;
    /// WindowsAutomation.BringWindowToForeground(revitWindow);
    /// </code>
    /// </summary>
    /// <param name="windowTitle">The title of the window to bring to the foreground.</param>
    public static bool BringWindowToForeground(string windowTitle) {
        var hWnd = FindWindow(null, windowTitle);
        if (hWnd == IntPtr.Zero) {
            Debug.WriteLine($"Window with title '{windowTitle}' not found.");
            return false;
        }

        // Restore the window if it's minimized
        _ = ShowWindow(hWnd, SW_RESTORE);
        _ = SetForegroundWindow(hWnd);
        Debug.WriteLine($"Brought window '{windowTitle}' to foreground.");
        return true;
    }
}