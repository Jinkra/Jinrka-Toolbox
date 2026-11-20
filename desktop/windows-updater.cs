using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class WindowsUpdater {
    private static int Main() {
        string target = Environment.GetEnvironmentVariable("JINKRA_UPDATE_TARGET");
        string source = Environment.GetEnvironmentVariable("JINKRA_UPDATE_STAGED");
        string ready = Environment.GetEnvironmentVariable("JINKRA_UPDATE_READY");
        string error = Environment.GetEnvironmentVariable("JINKRA_UPDATE_ERROR");
        string backup = source + ".rollback";
        bool replaced = false;
        bool launched = false;
        try {
            File.WriteAllText(ready, "ready");
            int parentId = int.Parse(Environment.GetEnvironmentVariable("JINKRA_UPDATE_PARENT"));
            try {
                using (Process parent = Process.GetProcessById(parentId)) { parent.WaitForExit(30000); }
            } catch (ArgumentException) { }
            for (int attempt = 0; ; attempt++) {
                try {
                    File.Replace(source, target, backup);
                    replaced = true;
                    break;
                } catch (IOException) {
                    if (attempt >= 119) throw;
                    Thread.Sleep(250);
                }
            }
            Launch(target);
            launched = true;
            return 0;
        } catch (Exception problem) {
            try { File.WriteAllText(error, "更新未完成，已尝试保留原版本。" + problem.Message); } catch (IOException) { }
            if (replaced && File.Exists(backup)) {
                try { File.Replace(backup, target, null); } catch (IOException) { return 1; }
            }
            try { Launch(target); } catch (Exception) { }
            return 1;
        } finally {
            Clean(source);
            Clean(ready);
            if (launched) Clean(backup);
            try { Directory.Delete(Path.GetDirectoryName(source)); } catch (IOException) { }
        }
    }

    private static void Launch(string target) {
        Process.Start(new ProcessStartInfo(target) {
            WorkingDirectory = Path.GetDirectoryName(target),
            UseShellExecute = false,
            CreateNoWindow = true
        }).Dispose();
    }

    private static void Clean(string file) {
        try { File.Delete(file); } catch (IOException) { }
    }
}
