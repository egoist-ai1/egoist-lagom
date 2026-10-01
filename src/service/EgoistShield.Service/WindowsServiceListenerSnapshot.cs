using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

// Reads only local OS metadata. A timed-out native call is never reused as a
// healthy result, and at most one outstanding read is retained per reader.
internal sealed class WindowsServiceListenerSnapshot
{
    private readonly string _serviceName;
    private readonly object _readLock = new();
    private Task<ServiceListenerSnapshot?>? _pending;
    private readonly Func<int, CancellationToken, ServiceListenerSnapshot?> _collect;

    internal WindowsServiceListenerSnapshot(string serviceName,
        Func<int, CancellationToken, ServiceListenerSnapshot?>? collect = null)
    {
        if (serviceName is not ("EgoistShieldTelegramProxy" or "EgoistShieldVpn"))
            throw new ArgumentException("Native snapshot requires an owned TCP service.");
        _serviceName = serviceName;
        _collect = collect ?? ((port, token) => Collect(_serviceName, port, token));
    }

    internal async Task<ServiceListenerSnapshot?> ReadAsync(int port, CancellationToken cancellationToken)
    {
        if (port < 1 || port > 65535) throw new ArgumentException("Native snapshot requires a valid port.");
        cancellationToken.ThrowIfCancellationRequested();
        Task<ServiceListenerSnapshot?> read;
        lock (_readLock)
        {
            if (_pending is { IsCompleted: false }) return null;
            read = _pending = Task.Run(() =>
            {
                try { return _collect(port, cancellationToken); }
                catch (Exception error) when (error is Win32Exception or IOException or
                    ArgumentException or OverflowException or OperationCanceledException or
                    DllNotFoundException or EntryPointNotFoundException or NotSupportedException)
                { return null; }
            }, CancellationToken.None);
        }
        return await read.WaitAsync(cancellationToken);
    }

    private static ServiceListenerSnapshot Collect(string serviceName, int port, CancellationToken token)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        token.ThrowIfCancellationRequested();
        using var manager = Native.OpenSCManager(null, null, 1);
        if (manager.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        using var service = Native.OpenService(manager, serviceName, 4);
        if (service.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var before = ReadService(service, token);
        var handles = new Dictionary<int, SafeProcessHandle>();
        try
        {
            var parents = ReadParents(token);
            var listeners = ReadListeners(port, token);
            var needed = new HashSet<int>();
            if (before.ProcessId > 0) needed.Add(checked((int)before.ProcessId));
            foreach (var listener in listeners)
            {
                int cursor = listener.OwningProcess;
                for (int depth = 0; depth < 32 && cursor > 0; depth++)
                {
                    if (!needed.Add(cursor)) break;
                    if (!parents.TryGetValue(cursor, out cursor)) break;
                }
            }
            if (needed.Count > 128) throw new InvalidDataException("Listener ancestry exceeds its bound.");
            var rows = new List<ListenerProcess>(needed.Count);
            foreach (int processId in needed)
            {
                token.ThrowIfCancellationRequested();
                parents.TryGetValue(processId, out int parent);
                var handle = Native.OpenProcess(0x1000U | (processId == before.ProcessId ? 0x100000U : 0U), false, processId);
                handles.Add(processId, handle);
                if (handle.IsInvalid)
                {
                    rows.Add(new(processId, parent, null, null));
                    continue;
                }
                DateTimeOffset? born = null;
                if (Native.GetProcessTimes(handle, out var created, out _, out _, out _))
                    born = DateTimeOffset.FromFileTime(unchecked((long)(((ulong)created.High << 32) | created.Low))).ToUniversalTime();
                string? executable = null;
                var path = new StringBuilder(32768);
                int length = path.Capacity;
                if (Native.QueryFullProcessImageName(handle, 0, path, ref length)) executable = path.ToString();
                rows.Add(new(processId, parent, born, executable));
            }
            var after = ReadService(service, token);
            bool stable = before.ProcessId == after.ProcessId && before.CurrentState == after.CurrentState;
            if (before.ProcessId > 0)
                stable &= handles.TryGetValue(checked((int)before.ProcessId), out var root) && !root.IsInvalid &&
                    Native.WaitForSingleObject(root, 0) == 258;
            token.ThrowIfCancellationRequested();
            return new(checked((int)before.ProcessId), State(before.CurrentState), rows.ToArray(), listeners, stable);
        }
        finally { foreach (var handle in handles.Values) handle.Dispose(); }
    }

    private static Native.ServiceStatus ReadService(Native.ServiceHandle service, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!Native.QueryServiceStatusEx(service, 0, out var status, Marshal.SizeOf<Native.ServiceStatus>(), out _))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        // SCM does not define dwProcessId for a stopped service.
        if (status.CurrentState == 1) status.ProcessId = 0;
        token.ThrowIfCancellationRequested();
        return status;
    }

    private static string State(uint value) => value switch
    { 1 => "Stopped", 2 => "Start Pending", 3 => "Stop Pending", 4 => "Running",
      5 => "Continue Pending", 6 => "Pause Pending", 7 => "Paused", _ => "Unknown" };

    private static Dictionary<int, int> ReadParents(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var snapshot = Native.CreateToolhelp32Snapshot(2, 0);
        if (snapshot.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var entry = new Native.ProcessEntry { Size = (uint)Marshal.SizeOf<Native.ProcessEntry>() };
        var parents = new Dictionary<int, int>();
        if (!Native.Process32First(snapshot, ref entry))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 18) return parents;
            throw new Win32Exception(error);
        }
        do
        {
            token.ThrowIfCancellationRequested();
            if (parents.Count >= 65536) throw new InvalidDataException("Process snapshot exceeds its bound.");
            if (entry.ProcessId > 0 && entry.ProcessId <= int.MaxValue && entry.ParentProcessId <= int.MaxValue)
                parents[checked((int)entry.ProcessId)] = checked((int)entry.ParentProcessId);
        } while (Native.Process32Next(snapshot, ref entry));
        int last = Marshal.GetLastWin32Error();
        if (last != 18) throw new Win32Exception(last);
        return parents;
    }

    internal static int ReadParentProcessId(int processId, CancellationToken cancellationToken) =>
        ReadParents(cancellationToken).GetValueOrDefault(processId);

    internal static ListenerEndpoint[] ReadListeners(int port, CancellationToken token)
    {
        if (port < 1 || port > 65535) throw new ArgumentException("Native listener capture requires a valid port.");
        var endpoints = new List<ListenerEndpoint>();
        foreach (int family in new[] { 2, 23 })
        {
            token.ThrowIfCancellationRequested();
            int size = 0;
            uint result = Native.GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 3, 0);
            if (result != 0 && result != 122) throw new Win32Exception(checked((int)result));
            bool captured = false;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                token.ThrowIfCancellationRequested();
                if (size < 4 || size > 4 * 1024 * 1024) throw new InvalidDataException("TCP table exceeds its bound.");
                int allocated = size;
                IntPtr memory = Marshal.AllocHGlobal(allocated);
                try
                {
                    result = Native.GetExtendedTcpTable(memory, ref size, false, family, 3, 0);
                    if (result == 122) continue;
                    if (result != 0) throw new Win32Exception(checked((int)result));
                    int count = Marshal.ReadInt32(memory);
                    int rowSize = family == 2 ? 24 : 56;
                    if (count < 0 || count > 65536 || 4L + (long)count * rowSize > allocated)
                        throw new InvalidDataException("TCP table is malformed.");
                    for (int index = 0; index < count; index++)
                    {
                        token.ThrowIfCancellationRequested();
                        IntPtr row = IntPtr.Add(memory, checked(4 + index * rowSize));
                        int rawPort = Marshal.ReadInt32(row, family == 2 ? 8 : 20);
                        int localPort = ((rawPort & 255) << 8) | ((rawPort >> 8) & 255);
                        if (localPort != port) continue;
                        int pid = Marshal.ReadInt32(row, family == 2 ? 20 : 52);
                        if (pid <= 0) throw new InvalidDataException("TCP owner identity is unavailable.");
                        string address;
                        if (family == 2) address = new IPAddress(BitConverter.GetBytes(Marshal.ReadInt32(row, 4))).ToString();
                        else
                        {
                            var bytes = new byte[16]; Marshal.Copy(row, bytes, 0, bytes.Length);
                            address = new IPAddress(bytes, unchecked((uint)Marshal.ReadInt32(row, 16))).ToString();
                        }
                        endpoints.Add(new(address, localPort, pid));
                        if (endpoints.Count > 128) throw new InvalidDataException("Listener snapshot exceeds its bound.");
                    }
                    captured = true;
                    break;
                }
                finally { Marshal.FreeHGlobal(memory); }
            }
            if (!captured) throw new IOException("TCP table changed during bounded capture.");
        }
        return endpoints.ToArray();
    }

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        internal struct ServiceStatus
        { internal uint ServiceType, CurrentState, ControlsAccepted, Win32ExitCode, ServiceSpecificExitCode,
            CheckPoint, WaitHint, ProcessId, ServiceFlags; }
        [StructLayout(LayoutKind.Sequential)]
        internal struct FileTime { internal uint Low, High; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct ProcessEntry
        {
            internal uint Size, Usage, ProcessId;
            internal UIntPtr DefaultHeap;
            internal uint ModuleId, Threads, ParentProcessId;
            internal int Priority;
            internal uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] internal string FileName;
        }
        internal sealed class ServiceHandle : SafeHandleZeroOrMinusOneIsInvalid
        {
            private ServiceHandle() : base(true) { }
            protected override bool ReleaseHandle() => CloseServiceHandle(handle);
        }
        internal sealed class SnapshotHandle : SafeHandleZeroOrMinusOneIsInvalid
        {
            private SnapshotHandle() : base(true) { }
            protected override bool ReleaseHandle() => CloseHandle(handle);
        }
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("advapi32.dll", EntryPoint = "OpenSCManagerW", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern ServiceHandle OpenSCManager(string? machine, string? database, uint access);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("advapi32.dll", EntryPoint = "OpenServiceW", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern ServiceHandle OpenService(ServiceHandle manager, string serviceName, uint access);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool QueryServiceStatusEx(ServiceHandle service, int level, out ServiceStatus status, int size, out int needed);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("advapi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseServiceHandle(IntPtr handle);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern SnapshotHandle CreateToolhelp32Snapshot(uint flags, uint pid);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool Process32First(SnapshotHandle snapshot, ref ProcessEntry entry);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool Process32Next(SnapshotHandle snapshot, ref ProcessEntry entry);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, int pid);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetProcessTimes(SafeProcessHandle process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool QueryFullProcessImageName(SafeProcessHandle process, int flags, StringBuilder name, ref int size);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("iphlpapi.dll", SetLastError = true)]
        internal static extern uint GetExtendedTcpTable(IntPtr table, ref int size, [MarshalAs(UnmanagedType.Bool)] bool order, int family, int tableClass, uint reserved);
    }
}

