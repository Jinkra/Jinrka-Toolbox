using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("小金工具箱")]
[assembly: AssemblyProduct("小金工具箱")]

// Installed as "Jinkra 工具箱.exe" so updaters, pins and login items from older releases still open the renamed app.
internal static class LegacyLauncher {
    private static int Main() {
        try {
            string folder = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string command = Environment.CommandLine;
            int split = command.StartsWith("\"") ? command.IndexOf('"', 1) + 1 : command.IndexOf(' ');
            string arguments = split <= 0 || split >= command.Length ? "" : command.Substring(split).TrimStart();
            Process.Start(new ProcessStartInfo(Path.Combine(folder, "小金工具箱.exe"), arguments) {
                WorkingDirectory = folder, UseShellExecute = false
            }).Dispose();
            return 0;
        } catch { return 1; }
    }
}
