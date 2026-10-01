using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

internal static class VpnRuntimeHost
{
    internal static string ResolveInstalledRoot()
    {
        string executable = Environment.ProcessPath ?? throw new InvalidOperationException("VPN host executable identity is unavailable.");
        string root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(executable)!, "..", "..", ".."));
        string expected = Path.Combine(root, "resources", "core-service", "win-x64", "EgoistShield.Service.exe");
        if (!executable.Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("VPN host requires its installed fixed path.");
        ClientAuthorizer.EnsureProgramFilesRoot(root);
        return root;
    }

    internal static async Task<int> RunAsync()
    {
        Process? child = null;
        try
        {
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
            using var identity = WindowsIdentity.GetCurrent();
            if (!identity.User!.IsWellKnown(WellKnownSidType.LocalSystemSid))
                throw new UnauthorizedAccessException("Background VPN requires the Windows service account.");
            string installRoot = ResolveInstalledRoot();
            using var trustedRuntime = ProtectedExecutable.OpenHost(installRoot, "cli");
            string runtime = Path.Combine(installRoot, "resources", "runtime", "sing-box", "sing-box.exe");
            trustedRuntime.VerifyBundledRuntime(runtime, "sing-box");
            string productRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EgoistShield");
            var intent = await new OwnedServiceIntentStore(Path.Combine(productRoot, "Service")).ReadAsync(CancellationToken.None);
            if (!intent.Services.TryGetValue(ServiceContract.VpnServiceName, out var desired) || !desired.Running)
                throw new InvalidOperationException("Background VPN is intentionally disabled or its intent is unavailable.");
            using var connection = VpnServiceConfiguration.Open(productRoot);
            using var parent = await OpenWrapperParentAsync(productRoot);
            string runtimeDirectory = Path.Combine(productRoot, "Runtime", "Vpn");
            VpnServiceConfiguration.AssertPrivatePath(runtimeDirectory, productRoot);
            using var hostLease = new FileStream(Path.Combine(runtimeDirectory, "host.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            string configPath = Path.Combine(runtimeDirectory, "config.json");
            await WriteDerivedConfigAsync(configPath, connection.Value.Config);
            VpnServiceConfiguration.AssertPrivatePath(configPath, productRoot);
            using var configLease = new FileStream(configPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            {
                using var cancellation = new CancellationTokenSource();
                ConsoleCancelEventHandler onCancel = (_, args) => { args.Cancel = true; cancellation.Cancel(); };
                Console.CancelKeyPress += onCancel;
                try
                {
                    string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
                    string windows = Directory.GetParent(system)!.FullName;
                    using var job = VpnChildJob.Create();
                    string environment = "PATH=" + system + "\0SystemRoot=" + windows + "\0TEMP=" + runtimeDirectory + "\0TMP=" + runtimeDirectory + "\0WINDIR=" + windows + "\0\0";
                    // Assign at creation, before the runtime's first instruction.
                    // A crash between Process.Start and Assign would orphan TUN.
                    child = job.Start(runtime, new[] { "run", "-c", configPath }, Path.GetDirectoryName(runtime)!, environment);
                    try
                    {
                        Task runtimeExit = child.WaitForExitAsync(cancellation.Token), parentExit = parent.WaitForExitAsync(cancellation.Token);
                        if (await Task.WhenAny(runtimeExit, parentExit) == parentExit && !child.HasExited)
                        { child.Kill(entireProcessTree: true); await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
                        else await runtimeExit;
                    }
                    catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
                    {
                        if (!child.HasExited) child.Kill(entireProcessTree: true);
                        await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
                    }
                    int exitCode = child.ExitCode;
                    Console.Error.WriteLine("Background VPN runtime exited; code=" + exitCode + ".");
                    return cancellation.IsCancellationRequested ? 0 : exitCode == 0 ? 1 : exitCode;
                }
                finally { Console.CancelKeyPress -= onCancel; }
            }
        }
        catch (Exception)
        {
            // Do not echo paths, configuration or runtime exception details.
            Console.Error.WriteLine("Background VPN startup or runtime verification failed; inspect the authenticated service status.");
            return 1;
        }
        finally
        {
            if (child != null)
            {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                child.Dispose();
            }
        }
    }

    private static async Task<Process> OpenWrapperParentAsync(string productRoot)
    {
        int parentId = WindowsServiceListenerSnapshot.ReadParentProcessId(Environment.ProcessId, CancellationToken.None);
        if (parentId <= 0) throw new InvalidOperationException("VPN wrapper parent identity is unavailable.");
        string expected = Path.Combine(productRoot, "Runtime", "Vpn", "service-wrapper", "egoistshield-vpn-service.exe");
        var reader = new WindowsServiceListenerSnapshot(ServiceContract.VpnServiceName);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        while (true)
        {
            var snapshot = await reader.ReadAsync(ServiceContract.VpnProxyPort, deadline.Token);
            var root = snapshot == null ? null : Array.Find(snapshot.Processes, row => row.ProcessId == parentId);
            if (snapshot is { Stable: true, ServiceState: "Running" } && snapshot.ServiceProcessId == parentId && root?.CreatedAt != null &&
                string.Equals(root.ExecutablePath, expected, StringComparison.OrdinalIgnoreCase))
            {
                var parent = Process.GetProcessById(parentId);
                try
                {
                    _ = parent.SafeHandle;
                    if (parent.HasExited || parent.StartTime.ToUniversalTime() != root.CreatedAt.Value.UtcDateTime)
                        throw new InvalidOperationException("VPN wrapper process identity changed.");
                    return parent;
                }
                catch { parent.Dispose(); throw; }
            }
            if (snapshot is { ServiceState: "Stopped" }) throw new InvalidOperationException("VPN wrapper is stopped.");
            await Task.Delay(100, deadline.Token);
        }
    }

    private static async Task WriteDerivedConfigAsync(string file, string content)
    {
        if (File.Exists(file) && await File.ReadAllTextAsync(file, new UTF8Encoding(false, true)) == content) return;
        string temporary = Path.Combine(Path.GetDirectoryName(file)!, ".config-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                await stream.WriteAsync(Encoding.UTF8.GetBytes(content)); stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, file, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

// A host crash closes this handle and terminates only this runtime's job. A
// second SCM start cannot leave an orphaned TUN process occupying the route.
internal sealed class VpnChildJob : SafeHandleZeroOrMinusOneIsInvalid
{
    private VpnChildJob() : base(true) { }
    internal static VpnChildJob Create()
    {
        var result = CreateJobObject(IntPtr.Zero, null);
        if (result.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits { Basic = new BasicLimits { LimitFlags = 0x2000 } };
        if (!SetInformationJobObject(result, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()))
        { result.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        return result;
    }
    internal void Assign(Process process)
    {
        if (!AssignProcessToJobObject(this, process.SafeHandle))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    internal Process Start(string executable, string[] arguments, string directory, string? environment = null)
    {
        IntPtr attributes = IntPtr.Zero, jobList = IntPtr.Zero, handleList = IntPtr.Zero, environmentPointer = IntPtr.Zero;
        bool initialized = false;
        var security = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), InheritHandle = true };
        using var sink = CreateFile("NUL", 0xC0000000, 3, ref security, 3, 0, IntPtr.Zero);
        if (sink.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            UIntPtr bytes = UIntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref bytes);
            attributes = Marshal.AllocHGlobal(checked((int)bytes.ToUInt64()));
            if (!InitializeProcThreadAttributeList(attributes, 2, 0, ref bytes)) throw new Win32Exception(Marshal.GetLastWin32Error());
            initialized = true;
            jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, DangerousGetHandle());
            handleList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(handleList, sink.DangerousGetHandle());
            if (!UpdateProcThreadAttribute(attributes, 0, (UIntPtr)0x2000d, jobList, (UIntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero) ||
                !UpdateProcThreadAttribute(attributes, 0, (UIntPtr)0x20002, handleList, (UIntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var startup = new StartupInfoEx
            {
                Startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Flags = 0x100,
                    Input = sink.DangerousGetHandle(), Output = sink.DangerousGetHandle(), Error = sink.DangerousGetHandle() },
                Attributes = attributes
            };
            if (environment != null) environmentPointer = Marshal.StringToHGlobalUni(environment);
            var command = new StringBuilder(Quote(executable) + " " + string.Join(" ", Array.ConvertAll(arguments, Quote)));
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080000 | 0x400, environmentPointer, directory, ref startup, out var processInfo))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            try { var process = Process.GetProcessById(checked((int)processInfo.ProcessId)); _ = process.SafeHandle; return process; }
            finally { CloseHandle(processInfo.Thread); CloseHandle(processInfo.Process); }
        }
        finally
        {
            if (initialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            if (environmentPointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentPointer);
        }
    }
    private static string Quote(string value)
    {
        var quoted = new StringBuilder("\""); int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { quoted.Append('\\', slashes * 2 + 1); quoted.Append(character); }
            else { quoted.Append('\\', slashes); quoted.Append(character); }
            slashes = 0;
        }
        quoted.Append('\\', slashes * 2); quoted.Append('"'); return quoted.ToString();
    }
    protected override bool ReleaseHandle() => CloseHandle(handle);
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
    { internal long PerProcessUserTimeLimit, PerJobUserTimeLimit; internal uint LimitFlags; internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; internal uint ActiveProcessLimit; internal UIntPtr Affinity; internal uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    { internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits
    { internal BasicLimits Basic; internal IoCounters Io; internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { internal int Length; internal IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] internal bool InheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo
    { internal int Size; internal IntPtr Reserved, Desktop, Title; internal uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags; internal ushort ShowWindow, ReservedBytes; internal IntPtr ReservedPointer, Input, Output, Error; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { internal StartupInfo Startup; internal IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string name, uint access, uint share, ref SecurityAttributes attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref UIntPtr bytes);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcess(string executable, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation information);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern VpnChildJob CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(VpnChildJob job, int informationClass, ref ExtendedLimits information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(VpnChildJob job, SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
