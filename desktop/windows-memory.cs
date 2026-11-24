using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

internal static class WindowsMemory {
    private const uint SetQuota = 0x0100;
    private const uint QueryLimitedInformation = 0x1000;
    private const long MinimumWorkingSet = 64L * 1024 * 1024;

    // SYSTEM_INFORMATION_CLASS values and SYSTEM_MEMORY_LIST_COMMAND values used by Windows memory tools.
    private const int SystemFileCacheInformationEx = 81;
    private const int SystemMemoryListInformation = 80;
    private const int SystemCombinePhysicalMemoryInformation = 130;
    private const int MemoryEmptyWorkingSets = 2;
    private const int MemoryFlushModifiedList = 3;
    private const int MemoryPurgeStandbyList = 4;
    private const int MemoryPurgeLowPriorityStandbyList = 5;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr process);
    [DllImport("psapi.dll", SetLastError = true)]
    private static extern bool EmptyWorkingSet(IntPtr process);
    [DllImport("ntdll.dll")]
    private static extern int NtSetSystemInformation(int infoClass, IntPtr info, int length);
    [DllImport("ntdll.dll")]
    private static extern int RtlAdjustPrivilege(int privilege, bool enable, bool currentThread, out bool previous);

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatus {
        public uint Length, Load;
        public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileCacheInformation {
        public UIntPtr CurrentSize, PeakSize;
        public uint PageFaultCount;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet, CurrentSizeIncludingTransitionInPages, PeakSizeIncludingTransitionInPages;
        public uint TransitionRePurposeCount, Flags;
    }

    private static ulong Available() {
        var status = new MemoryStatus { Length = (uint)Marshal.SizeOf(typeof(MemoryStatus)) };
        return GlobalMemoryStatusEx(ref status) ? status.AvailPhys : 0;
    }

    private static int TrimProcesses(bool everySession) {
        int count = 0;
        using (Process self = Process.GetCurrentProcess()) {
            foreach (Process process in Process.GetProcesses()) {
                using (process) {
                    try {
                        if (process.Id == self.Id || process.Id <= 4) continue;
                        if (!everySession && (process.SessionId != self.SessionId || process.SessionId == 0 ||
                            process.WorkingSet64 < MinimumWorkingSet)) continue;
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
        return count;
    }

    private static bool Command(int infoClass, int command) {
        IntPtr buffer = Marshal.AllocHGlobal(4);
        try {
            Marshal.WriteInt32(buffer, command);
            return NtSetSystemInformation(infoClass, buffer, 4) >= 0;
        } finally { Marshal.FreeHGlobal(buffer); }
    }

    private static bool FlushFileCache() {
        var info = new FileCacheInformation {
            MinimumWorkingSet = new UIntPtr(ulong.MaxValue >> (IntPtr.Size == 8 ? 0 : 32)),
            MaximumWorkingSet = new UIntPtr(ulong.MaxValue >> (IntPtr.Size == 8 ? 0 : 32)),
        };
        int size = Marshal.SizeOf(typeof(FileCacheInformation));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(info, buffer, false);
            return NtSetSystemInformation(SystemFileCacheInformationEx, buffer, size) >= 0;
        } finally { Marshal.FreeHGlobal(buffer); }
    }

    private static bool Combine() {
        // MEMORY_COMBINE_INFORMATION_EX: Handle, PagesCombined, Flags.
        int size = IntPtr.Size * 2 + 8;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            for (int i = 0; i < size; i++) Marshal.WriteByte(buffer, i, 0);
            return NtSetSystemInformation(SystemCombinePhysicalMemoryInformation, buffer, size) >= 0;
        } finally { Marshal.FreeHGlobal(buffer); }
    }

    private static int Main(string[] args) {
        if (args.Length == 2 && args[0] == "--deep") {
            ulong before = Available();
            bool previous;
            // SeIncreaseQuotaPrivilege (5) and SeProfileSingleProcessPrivilege (13) unlock the system memory lists.
            bool granted = RtlAdjustPrivilege(5, true, false, out previous) >= 0 &
                RtlAdjustPrivilege(13, true, false, out previous) >= 0;
            int count = TrimProcesses(true);
            int steps = 0;
            if (granted) {
                if (Command(SystemMemoryListInformation, MemoryEmptyWorkingSets)) steps++;
                if (FlushFileCache()) steps++;
                if (Command(SystemMemoryListInformation, MemoryFlushModifiedList)) steps++;
                if (Command(SystemMemoryListInformation, MemoryPurgeLowPriorityStandbyList)) steps++;
                if (Command(SystemMemoryListInformation, MemoryPurgeStandbyList)) steps++;
                if (Combine()) steps++;
            }
            ulong after = Available();
            File.WriteAllText(args[1], "{\"count\":" + count + ",\"steps\":" + steps + ",\"before\":" + before + ",\"after\":" + after + "}");
            return granted ? 0 : 2;
        }
        Console.WriteLine(TrimProcesses(false));
        return 0;
    }
}
