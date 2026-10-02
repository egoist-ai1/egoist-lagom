using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

internal static partial class SystemDohRecoveryPreflight
{
    // Dedicated installer probe. The child belongs to a kill-on-close job at
    // CreateProcess, before it executes or binds a port. Abrupt owner exit or
    // an installer timeout cannot orphan a resolver or leave its private stdin.
    internal static async Task<bool> ProbeContainedMigrationCandidateAsync(string image, string candidate, int port, bool ipv6, CancellationToken token)
    {
        if (!OperatingSystem.IsWindows() || port is < 49152 or > 65535 || Encoding.UTF8.GetByteCount(candidate) > 65536) return false;
        token.ThrowIfCancellationRequested();
        using var child = MigrationCandidateProcess.Start(image);
        bool ready = false;
        try
        {
            token.ThrowIfCancellationRequested();
            var identity = OwnedSystemDohProcess.ReadRuntimeIdentity(child.Handle, token);
            if (!identity.Path.Equals(Path.GetFullPath(image), StringComparison.OrdinalIgnoreCase)) return false;
            await child.WriteConfigurationAsync(candidate, token);
            var startup = Stopwatch.StartNew();
            while (true)
            {
                token.ThrowIfCancellationRequested();
                OwnedSystemDohProcess.VerifyRuntimeIdentity(child.Handle, image, identity.Born, token);
                var rows = ReadRows(port, token);
                if (HasForeign(rows, child.ProcessId)) return false;
                if (OwnsEndpoints(rows, port, child.ProcessId, ipv6)) break;
                if (startup.Elapsed >= TimeSpan.FromSeconds(2)) return false;
                await Task.Delay(50, token);
            }
            ready = await SystemDohServiceHealthProbe.LocalQueryAsync(System.Net.IPAddress.Loopback, port,
                SystemDohServiceHealthProbe.BuildQuery(), SystemDohServiceHealthProbe.ProbeTimeout, token);
            OwnedSystemDohProcess.VerifyRuntimeIdentity(child.Handle, image, identity.Born, token);
            ready &= OwnsEndpoints(ReadRows(port, token), port, child.ProcessId, ipv6);
        }
        finally
        {
            child.CloseJob();
            if (MigrationCandidateProcess.WaitForExit(child.Handle, 1000) != 0) ready = false;
        }
        return ready;
    }

    private sealed class MigrationCandidateProcess : IDisposable
    {
        private CandidateJob? _job;
        private readonly FileStream _input;
        internal SafeProcessHandle Handle { get; }
        internal int ProcessId { get; }
        private MigrationCandidateProcess(CandidateJob job, SafeProcessHandle process, int pid, SafeFileHandle input)
        { _job = job; Handle = process; ProcessId = pid; _input = new FileStream(input, FileAccess.Write, 4096, isAsync: false); }
        internal static MigrationCandidateProcess Start(string image)
        {
            CandidateJob? job = null; SafeFileHandle? read = null, write = null;
            SafeProcessHandle? process = null;
            IntPtr attributes = IntPtr.Zero, jobList = IntPtr.Zero, handleList = IntPtr.Zero;
            bool initialized = false;
            var security = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), InheritHandle = true };
            try
            {
                job = CreateJobObject(IntPtr.Zero, null);
                if (job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } };
                if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (!CreatePipe(out read, out write, ref security, 65536) || !SetHandleInformation(write, 1, 0))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                using var sink = CreateFile("NUL", 0xC0000000, 3, ref security, 3, 0, IntPtr.Zero);
                if (sink.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                UIntPtr bytes = UIntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref bytes);
                attributes = Marshal.AllocHGlobal(checked((int)bytes.ToUInt64()));
                if (!InitializeProcThreadAttributeList(attributes, 2, 0, ref bytes)) throw new Win32Exception(Marshal.GetLastWin32Error());
                initialized = true;
                jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job.DangerousGetHandle());
                handleList = Marshal.AllocHGlobal(IntPtr.Size * 2); Marshal.WriteIntPtr(handleList, read.DangerousGetHandle()); Marshal.WriteIntPtr(handleList, IntPtr.Size, sink.DangerousGetHandle());
                if (!UpdateProcThreadAttribute(attributes, 0, (UIntPtr)0x2000d, jobList, (UIntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero) ||
                    !UpdateProcThreadAttribute(attributes, 0, (UIntPtr)0x20002, handleList, (UIntPtr)(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                var startup = new StartupInfoEx
                { Startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Flags = 0x100,
                    Input = read.DangerousGetHandle(), Output = sink.DangerousGetHandle(), Error = sink.DangerousGetHandle() }, Attributes = attributes };
                var command = new StringBuilder(Quote(Path.GetFullPath(image)) + " run -config stdin: -format json");
                if (!CreateProcess(Path.GetFullPath(image), command, IntPtr.Zero, IntPtr.Zero, true, 0x08080000,
                    IntPtr.Zero, Path.GetDirectoryName(Path.GetFullPath(image))!, ref startup, out var info)) throw new Win32Exception(Marshal.GetLastWin32Error());
                // Use the original creation handle. Reopening by PID could bind
                // a different generation if the executable exits immediately.
                process = new SafeProcessHandle(info.Process, true); CloseHandle(info.Thread);
                var result = new MigrationCandidateProcess(job, process, checked((int)info.ProcessId), write);
                job = null; process = null; write = null;
                return result;
            }
            finally
            {
                if (initialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
                if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
                job?.Dispose(); process?.Dispose(); read?.Dispose(); write?.Dispose();
            }
        }
        internal async Task WriteConfigurationAsync(string config, CancellationToken token)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(config);
            try { await _input.WriteAsync(bytes, token); await _input.FlushAsync(token); }
            finally { _input.Dispose(); }
        }
        internal void CloseJob() { _job?.Dispose(); _job = null; }
        public void Dispose() { CloseJob(); _input.Dispose(); Handle.Dispose(); }
        private static string Quote(string value)
        {
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { slashes++; continue; }
                result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes).Append(character); slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }
        private sealed class CandidateJob : SafeHandleZeroOrMinusOneIsInvalid
        { private CandidateJob() : base(true) { } protected override bool ReleaseHandle() => CloseHandle(handle); }
        [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
        { internal long ProcessTime, JobTime; internal uint Flags; internal UIntPtr MinWorkingSet, MaxWorkingSet; internal uint ActiveProcessLimit; internal UIntPtr Affinity; internal uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters
        { internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits
        { internal BasicLimits Basic; internal IoCounters Io; internal UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
        [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes
        { internal int Length; internal IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] internal bool InheritHandle; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo
        { internal int Size; internal IntPtr Reserved, Desktop, Title; internal uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags; internal ushort ShowWindow, ReservedBytes; internal IntPtr ReservedPointer, Input, Output, Error; }
        [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { internal StartupInfo Startup; internal IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern CandidateJob CreateJobObject(IntPtr attributes, string? name);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(CandidateJob job, int kind, ref ExtendedLimits limits, uint bytes);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, ref SecurityAttributes attributes, uint size);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string name, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, int flags, ref UIntPtr bytes);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, UIntPtr attribute, IntPtr value, UIntPtr bytes, IntPtr previous, IntPtr returned);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr attributes);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcess(string image, StringBuilder arguments, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject", SetLastError = true)] internal static extern uint WaitForExit(SafeProcessHandle process, uint milliseconds);
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    }
}
