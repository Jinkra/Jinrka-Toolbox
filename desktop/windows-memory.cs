using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

internal static class WindowsMemory {
    private const uint SetQuota = 0x0100;
    private const uint QueryLimitedInformation = 0x1000;
    private const long MinimumWorkingSet = 64L * 1024 * 1024;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr process);
    [DllImport("psapi.dll", SetLastError = true)]
    private static extern bool EmptyWorkingSet(IntPtr process);

    private static void Main() {
        int count = 0;
        using (Process self = Process.GetCurrentProcess()) {
            foreach (Process process in Process.GetProcesses()) {
                using (process) {
                    try {
                        if (process.Id == self.Id || process.SessionId != self.SessionId ||
                            process.SessionId == 0 || process.WorkingSet64 < MinimumWorkingSet) continue;
                        IntPtr handle = OpenProcess(SetQuota | QueryLimitedInformation, false, process.Id);
                        if (handle == IntPtr.Zero) continue;
                        try { if (EmptyWorkingSet(handle)) count++; }
                        finally { CloseHandle(handle); }
                    } catch (InvalidOperationException) {
                        // Exit between enumeration and opening the process.
                    } catch (System.ComponentModel.Win32Exception) {
                        // Protected or inaccessible process.
                    }
                }
            }
        }
        Console.WriteLine(count);
    }
}
