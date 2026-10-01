using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
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
        Func<int, CancellationToken, ServiceListenerSnapshot?>? collect = null, int? managedProcessId = null)
    {
        if (serviceName is not ("EgoistShieldTelegramProxy" or "EgoistShieldVpn"))
            throw new ArgumentException("Native snapshot requires an owned TCP service.");
        _serviceName = serviceName;
        if (managedProcessId is <= 0) throw new ArgumentException("Managed process identity must be positive.");
        _collect = collect ?? ((port, token) => Collect(_serviceName, port, token, managedProcessId));
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

    private static ServiceListenerSnapshot Collect(string serviceName, int port, CancellationToken token, int? managedProcessId)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        token.ThrowIfCancellationRequested();
        using var manager = Native.OpenSCManager(null, null, 1);
        if (manager.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        using var service = Native.OpenService(manager, serviceName, 4);
        bool absent = service.IsInvalid;
        if (absent && Marshal.GetLastWin32Error() != 1060) throw new Win32Exception(Marshal.GetLastWin32Error());
        var before = absent ? new Native.ServiceStatus { CurrentState = 1 } : ReadService(service, token);
        var handles = new Dictionary<int, SafeProcessHandle>();
        try
        {
            var parents = ReadParents(token);
            var listeners = ReadListeners(port, token);
            var needed = new HashSet<int>();
            if (before.ProcessId > 0) needed.Add(checked((int)before.ProcessId));
            if (managedProcessId is int managed) needed.Add(managed);
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
                var handle = Native.OpenProcess(0x1000U | 0x100000U, false, processId);
                handles.Add(processId, handle);
                if (handle.IsInvalid || !IsProcessAlive(handle))
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
            var after = before;
            if (absent)
            {
                using var check = Native.OpenService(manager, serviceName, 4);
                if (!check.IsInvalid || Marshal.GetLastWin32Error() != 1060)
                    throw new IOException("Owned service registration changed during listener capture.");
            }
            else after = ReadService(service, token);
            bool stable = before.ProcessId == after.ProcessId && before.CurrentState == after.CurrentState;
            if (before.ProcessId > 0)
                stable &= handles.TryGetValue(checked((int)before.ProcessId), out var root) && !root.IsInvalid &&
                    IsProcessAlive(root);
            if (managedProcessId is int managedRoot)
                stable &= handles.TryGetValue(managedRoot, out var managedHandle) && !managedHandle.IsInvalid &&
                    IsProcessAlive(managedHandle);
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

    private static bool IsProcessAlive(SafeProcessHandle handle) => Native.WaitForSingleObject(handle, 0) == 258;

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

    internal static ListenerProcess[] ReadWinwsProcesses(CancellationToken token)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        token.ThrowIfCancellationRequested();
        using var snapshot = Native.CreateToolhelp32Snapshot(2, 0);
        if (snapshot.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var entry = new Native.ProcessEntry { Size = (uint)Marshal.SizeOf<Native.ProcessEntry>() };
        if (!Native.Process32First(snapshot, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var rows = new List<ListenerProcess>();
        int count = 0;
        do
        {
            token.ThrowIfCancellationRequested();
            if (++count > 65536) throw new InvalidDataException("Process snapshot exceeds its bound.");
            if (!string.Equals(entry.FileName, "winws.exe", StringComparison.OrdinalIgnoreCase)) continue;
            if (rows.Count >= 128 || entry.ProcessId is 0 or > int.MaxValue || entry.ParentProcessId > int.MaxValue)
                throw new InvalidDataException("WinWS process snapshot exceeds its bound.");
            int processId = checked((int)entry.ProcessId);
            using var handle = Native.OpenProcess(0x1000U | 0x100000U, false, processId);
            if (handle.IsInvalid || !IsProcessAlive(handle) ||
                !Native.GetProcessTimes(handle, out var created, out _, out _, out _))
            { rows.Add(new(processId, checked((int)entry.ParentProcessId), null, null)); continue; }
            var executable = new StringBuilder(32768);
            int length = executable.Capacity;
            if (!Native.QueryFullProcessImageName(handle, 0, executable, ref length))
            { rows.Add(new(processId, checked((int)entry.ParentProcessId), null, null)); continue; }
            if (!Path.GetFileName(executable.ToString()).Equals("winws.exe", StringComparison.OrdinalIgnoreCase) ||
                !IsProcessAlive(handle))
            { rows.Add(new(processId, checked((int)entry.ParentProcessId), null, null)); continue; }
            var born = DateTimeOffset.FromFileTime(unchecked((long)(((ulong)created.High << 32) | created.Low))).ToUniversalTime();
            rows.Add(new(processId, checked((int)entry.ParentProcessId), born, executable.ToString()));
        } while (Native.Process32Next(snapshot, ref entry));
        if (Marshal.GetLastWin32Error() != 18) throw new Win32Exception(Marshal.GetLastWin32Error());
        return rows.ToArray();
    }

    internal sealed record RuntimeStoppedProcess(int ProcessId, DateTimeOffset CreatedAt, string ExecutablePath);

    // Only the fixed-target command exposes this operation. The internal exact-path
    // boundary also permits caller-owned harmless regression executables.
    internal static RuntimeStoppedProcess[] StopProcessesUsingExecutable(string executablePath, CancellationToken token)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (!Path.IsPathFullyQualified(executablePath)) throw new ArgumentException("Absolute runtime path required.");
        string expected = Path.GetFullPath(executablePath);
        var held = CaptureRuntimeProcesses(expected, token);
        var terminators = new List<(SafeProcessHandle Handle, RuntimeStoppedProcess Identity)>();
        var stopped = new List<RuntimeStoppedProcess>();
        try
        {
            // Prepare every termination handle before changing any process. The
            // original query handles stay held, preventing stale-PID substitution.
            foreach (var item in held)
            {
                token.ThrowIfCancellationRequested();
                if (Native.WaitForSingleObject(item.Handle, 0) == 0) continue;
                var handle = Native.OpenProcess(1U | 0x1000U | 0x100000U, false, item.Identity.ProcessId);
                if (handle.IsInvalid)
                {
                    int error = Marshal.GetLastWin32Error();
                    handle.Dispose();
                    if (Native.WaitForSingleObject(item.Handle, 0) == 0) continue;
                    throw new Win32Exception(error);
                }
                try
                {
                    VerifyRuntimeIdentity(handle, item.Identity.ExecutablePath, item.Identity.CreatedAt, token);
                    terminators.Add((handle, item.Identity));
                }
                catch (IOException) when (Native.WaitForSingleObject(handle, 0) == 0) { handle.Dispose(); }
                catch { handle.Dispose(); throw; }
            }
            foreach (var item in terminators)
            {
                token.ThrowIfCancellationRequested();
                if (Native.WaitForSingleObject(item.Handle, 0) == 0) continue;
                try { VerifyRuntimeIdentity(item.Handle, expected, item.Identity.CreatedAt, token); }
                catch (IOException) when (Native.WaitForSingleObject(item.Handle, 0) == 0) { continue; }
                if (!Native.TerminateProcess(item.Handle, 0))
                {
                    int error = Marshal.GetLastWin32Error();
                    if (Native.WaitForSingleObject(item.Handle, 0) == 0) continue;
                    throw new Win32Exception(error);
                }
                while (true)
                {
                    token.ThrowIfCancellationRequested();
                    uint wait = Native.WaitForSingleObject(item.Handle, 100);
                    if (wait == 0) break;
                    if (wait != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                stopped.Add(item.Identity);
            }
            // A recovery/respawn race refuses publication instead of kill-looping.
            VerifyRuntimeQuiescent(expected, token);
            token.ThrowIfCancellationRequested();
            return stopped.ToArray();
        }
        finally
        {
            foreach (var item in terminators) item.Handle.Dispose();
            foreach (var item in held) item.Handle.Dispose();
        }
    }

    // Default-null fixture lifecycle hook observes actual native rows; it cannot
    // supply identity or liveness and is never selected by production commands.
    internal static void VerifyRuntimeQuiescent(string expectedPath, CancellationToken token, Action? afterCapture = null)
    {
        var remaining = CaptureRuntimeProcesses(Path.GetFullPath(expectedPath), token);
        try
        {
            token.ThrowIfCancellationRequested();
            afterCapture?.Invoke();
            token.ThrowIfCancellationRequested();
            foreach (var item in remaining)
            {
                token.ThrowIfCancellationRequested();
                uint wait = Native.WaitForSingleObject(item.Handle, 0);
                int error = wait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
                token.ThrowIfCancellationRequested();
                if (wait == 0) continue;
                if (wait == 258)
                    throw new IOException($"Runtime restarted during cleanup (pid={item.Identity.ProcessId}; born={item.Identity.CreatedAt:O}; path={item.Identity.ExecutablePath}; wait={wait}).");
                throw new Win32Exception(error, $"Runtime quiescence liveness is unavailable (wait={wait}).");
            }
        }
        finally { foreach (var item in remaining) item.Handle.Dispose(); }
        token.ThrowIfCancellationRequested();
    }

    internal static void VerifyRuntimeIdentity(SafeProcessHandle handle, string expectedPath, DateTimeOffset expectedBirth, CancellationToken token = default)
    {
        var actual = ReadRuntimeIdentity(handle, token);
        if (!string.Equals(actual.Path, Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase) || actual.Born != expectedBirth)
            throw new InvalidDataException("Runtime process identity changed or is foreign.");
    }

    internal static void VerifyRuntimeProcessIdentity(int processId, string expectedPath, DateTimeOffset expectedBirth)
    {
        using var handle = Native.OpenProcess(0x1000U | 0x100000U, false, processId);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        VerifyRuntimeIdentity(handle, expectedPath, expectedBirth);
    }

    // The internal error-only seam cannot provide a successful path or birth.
    // Production calls leave it null and always use the native image query.
    internal static (string Path, DateTimeOffset Born) ReadRuntimeIdentity(SafeProcessHandle handle,
        CancellationToken token = default, Func<int, int?>? imageQueryError = null)
    {
        token.ThrowIfCancellationRequested();
        uint wait = Native.WaitForSingleObject(handle, 0);
        if (wait != 258) throw RuntimeIdentityFailure("wait", wait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0, wait, 0);
        bool times = Native.GetProcessTimes(handle, out var created, out _, out _, out _);
        int timeError = times ? 0 : Marshal.GetLastWin32Error();
        if (!times) throw RuntimeIdentityFailure("creation", timeError, Native.WaitForSingleObject(handle, 0), 0);
        token.ThrowIfCancellationRequested();
        var readClock = Stopwatch.StartNew();
        for (int attempt = 1; ; attempt++)
        {
            token.ThrowIfCancellationRequested();
            var image = ReadRuntimeImage(handle, imageQueryError?.Invoke(attempt));
            token.ThrowIfCancellationRequested();
            wait = Native.WaitForSingleObject(handle, 0);
            int waitError = wait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
            token.ThrowIfCancellationRequested();
            if (wait != 258)
                throw RuntimeIdentityFailure(wait == 0 ? "image" : "wait", wait == 0 ? image.NativeError : waitError, wait, attempt);
            if (!string.IsNullOrWhiteSpace(image.Path))
            {
                var born = DateTimeOffset.FromFileTime(unchecked((long)(((ulong)created.High << 32) | created.Low))).ToUniversalTime();
                return (Path.GetFullPath(image.Path), born);
            }
            int remaining = 250 - (int)readClock.ElapsedMilliseconds;
            if (remaining <= 0 || attempt >= 11)
                throw RuntimeIdentityFailure("image", image.NativeError, wait, attempt);
            // Image teardown may precede the process signal. Neither timeout nor
            // missing path proves exit: wait/requery this same handle only.
            token.ThrowIfCancellationRequested();
            wait = Native.WaitForSingleObject(handle, (uint)Math.Min(25, remaining));
            waitError = wait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
            token.ThrowIfCancellationRequested();
            if (wait != 258)
                throw RuntimeIdentityFailure(wait == 0 ? "image" : "wait", wait == 0 ? image.NativeError : waitError, wait, attempt);
        }
    }

    private static (string? Path, int NativeError) ReadRuntimeImage(SafeProcessHandle handle, int? injectedError)
    {
        if (injectedError is int error) return (null, error);
        var path = new StringBuilder(32768);
        int length = path.Capacity;
        if (!Native.QueryFullProcessImageName(handle, 0, path, ref length)) return (null, Marshal.GetLastWin32Error());
        return (path.ToString(), 0);
    }

    private static IOException RuntimeIdentityFailure(string stage, int nativeError, uint wait, int attempts) =>
        new($"Runtime identity is unavailable (stage={stage}; win32={nativeError}; wait={wait}; attempts={attempts}).");

    private static List<(SafeProcessHandle Handle, RuntimeStoppedProcess Identity)> CaptureRuntimeProcesses(string expected, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var snapshot = Native.CreateToolhelp32Snapshot(2, 0);
        if (snapshot.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var entry = new Native.ProcessEntry { Size = (uint)Marshal.SizeOf<Native.ProcessEntry>() };
        var held = new List<(SafeProcessHandle Handle, RuntimeStoppedProcess Identity)>();
        if (!Native.Process32First(snapshot, ref entry))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 18) return held;
            throw new Win32Exception(error);
        }
        int count = 0, matching = 0;
        try
        {
            do
            {
                token.ThrowIfCancellationRequested();
                if (++count > 65536) throw new InvalidDataException("Process snapshot exceeds its bound.");
                if (!string.Equals(entry.FileName, Path.GetFileName(expected), StringComparison.OrdinalIgnoreCase)) continue;
                if (++matching > 128 || entry.ProcessId is 0 or > int.MaxValue)
                    throw new InvalidDataException("Runtime candidate snapshot exceeds its bound.");
                int pid = checked((int)entry.ProcessId);
                var handle = Native.OpenProcess(0x1000U | 0x100000U, false, pid);
                if (handle.IsInvalid) { handle.Dispose(); throw new IOException("Runtime candidate is unreadable."); }
                try
                {
                    // Toolhelp may retain an exited process while another caller
                    // holds its handle. A signaled held handle proves it cannot
                    // use the runtime; unreadable/live unknown rows still refuse.
                    uint wait = Native.WaitForSingleObject(handle, 0);
                    int error = wait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
                    token.ThrowIfCancellationRequested();
                    if (wait == 0) { handle.Dispose(); continue; }
                    if (wait != 258) throw new Win32Exception(error, $"Runtime candidate liveness is unavailable (wait={wait}).");
                    // A readable foreign same-name process is never granted terminate rights.
                    var identity = ReadRuntimeIdentity(handle, token);
                    wait = Native.WaitForSingleObject(handle, 0);
                    error = wait == uint.MaxValue ? Marshal.GetLastWin32Error() : 0;
                    token.ThrowIfCancellationRequested();
                    if (wait == 0) { handle.Dispose(); continue; }
                    if (wait != 258) throw new Win32Exception(error, $"Runtime candidate liveness is unavailable after identity read (wait={wait}).");
                    if (!string.Equals(identity.Path, expected, StringComparison.OrdinalIgnoreCase)) { handle.Dispose(); continue; }
                    held.Add((handle, new(pid, identity.Born, identity.Path)));
                }
                // An exit can happen between the initial wait and image query.
                // Only this same held handle's signaled state permits omission.
                catch (IOException) when (Native.WaitForSingleObject(handle, 0) == 0) { handle.Dispose(); }
                catch { handle.Dispose(); throw; }
            } while (Native.Process32Next(snapshot, ref entry));
            if (Marshal.GetLastWin32Error() != 18) throw new Win32Exception(Marshal.GetLastWin32Error());
            token.ThrowIfCancellationRequested();
            return held;
        }
        catch { foreach (var item in held) item.Handle.Dispose(); throw; }
    }

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
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool TerminateProcess(SafeProcessHandle process, uint exitCode);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [DllImport("iphlpapi.dll", SetLastError = true)]
        internal static extern uint GetExtendedTcpTable(IntPtr table, ref int size, [MarshalAs(UnmanagedType.Bool)] bool order, int family, int tableClass, uint reserved);
    }
}

