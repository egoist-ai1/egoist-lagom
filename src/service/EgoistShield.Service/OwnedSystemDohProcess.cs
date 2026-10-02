using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

// Standalone fixed SystemDoH stop boundary, also compatible with the installed
// 3.7.9 Core. It exposes no new CLI/IPC operation and never matches a process by
// basename alone. Query handles remain held until all termination handles close.
internal static class OwnedSystemDohProcess
{
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

    // This fixed-target lease is internal to SystemDoH StopAsync. It retains the
    // original SCM object and process handle across graceful stopping; a reused
    // PID or replaced wrapper can never become the termination target.
    internal sealed class SystemDohWrapperLease : IDisposable
    {
        private readonly Native.ServiceHandle _service;
        private readonly SafeProcessHandle? _process;
        private readonly int _pid;
        private readonly string _path;
        private readonly DateTimeOffset _birth;
        internal SystemDohWrapperLease(string expectedPath, CancellationToken token)
        {
            _path = Path.GetFullPath(expectedPath);
            using var scm = Native.OpenSCManager(null, null, 1);
            if (scm.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            _service = Native.OpenService(scm, "EgoistShieldSystemDoH", 4);
            if (_service.IsInvalid) { int error = Marshal.GetLastWin32Error(); _service.Dispose(); throw new Win32Exception(error); }
            try
            {
                var status = ReadService(_service, token);
                if (status.ProcessId == 0) return;
                _pid = checked((int)status.ProcessId);
                _process = Native.OpenProcess(1U | 0x1000U | 0x100000U, false, _pid);
                if (_process.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var identity = ReadRuntimeIdentity(_process, token);
                if (!string.Equals(identity.Path, _path, StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException("SCM SystemDoH wrapper process has a foreign image.");
                _birth = identity.Born;
                var confirm = ReadService(_service, token);
                if (confirm.ProcessId != status.ProcessId || confirm.CurrentState != status.CurrentState)
                    throw new IOException("SCM SystemDoH wrapper changed during capture.");
            }
            catch { Dispose(); throw; }
        }
        internal Task AssertOriginalOrStoppedAsync(CancellationToken token)
        {
            var status = ReadService(_service, token);
            if (status.CurrentState != 1 && (_process == null || _pid <= 0 || status.ProcessId != _pid))
                throw new IOException("SCM SystemDoH wrapper generation changed during stop.");
            if (status.CurrentState != 1) VerifyRuntimeIdentity(_process!, _path, _birth, token);
            token.ThrowIfCancellationRequested(); return Task.CompletedTask;
        }
        internal async Task TerminateStopPendingAsync(Func<CancellationToken, Task> assertCurrent, CancellationToken token)
        {
            await assertCurrent(token);
            var before = ReadService(_service, token);
            if (before.CurrentState == 1) return;
            if (_process == null || _pid <= 0 || before.CurrentState != 3 || before.ProcessId != _pid)
                throw new IOException("Only the originally held SCM SystemDoH wrapper in stop_pending may be terminated.");
            VerifyRuntimeIdentity(_process, _path, _birth, token);
            // An intentional forced stop must not be mistaken for a crash by SCM.
            // The original recovery policy is restored even on cancellation.
            using var suppression = WindowsServiceRecoverySnapshot.SuppressSystemDohRecovery(_path, token);
            await assertCurrent(token);
            var last = ReadService(_service, token);
            if (last.CurrentState != 3 || last.ProcessId != _pid)
                throw new IOException("SCM SystemDoH changed before wrapper termination.");
            VerifyRuntimeIdentity(_process, _path, _birth, token);
            if (!Native.TerminateProcess(_process, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
            var clock = Stopwatch.StartNew();
            while (true)
            {
                token.ThrowIfCancellationRequested();
                uint wait = Native.WaitForSingleObject(_process, 0);
                if (wait != 0 && wait != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
                var status = ReadService(_service, token);
                if (wait == 0 && status.CurrentState == 1) return;
                if (status.ProcessId != 0 && status.ProcessId != _pid) throw new IOException("SCM replaced SystemDoH during forced stopping.");
                if (clock.Elapsed >= TimeSpan.FromSeconds(10)) throw new TimeoutException("SCM has not confirmed the exact SystemDoH wrapper exit.");
                await Task.Delay(100, token);
            }
        }
        public void Dispose() { _process?.Dispose(); _service.Dispose(); }
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





