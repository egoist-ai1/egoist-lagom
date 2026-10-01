using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace LegacyLaunchDiagnostic;

internal sealed record Options(string InstalledGuiPath, string ExpectedGuiSha256, string ExpectedOldVersion,
    string WorkRoot, string EvidenceDirectory, string ExpectedSourceCommit, string ReceiptPath);
internal sealed record Original(string Sha256, long Bytes);
internal sealed record Privilege(string Name, uint Attributes);
internal sealed record TokenProof(string UserSid, string IntegritySid, int Type, int ElevationType, bool Elevated,
    int SessionId, bool Restricted, bool AdministratorsPresent, bool AdministratorsEnabled,
    bool AdministratorsDenyOnly, IReadOnlyList<Privilege> Privileges);
internal sealed class Attempt
{
    public required string Sample { get; init; }
    public string TokenMethod { get; set; } = "";
    public TokenProof? Token { get; set; }
    public string Stage { get; set; } = "not-attempted";
    public bool ProcessCreated { get; set; }
    public int? Win32Error { get; set; }
    public int? RawLastPInvokeError { get; set; }
    public string? ErrorMessage { get; set; }
    public uint? ProcessId { get; set; }
    public string? HeldProcessPath { get; set; }
    public int? JobAssignmentError { get; set; }
    public bool? OwnHeldProcessTerminated { get; set; }
    public bool? OwnHeldProcessExitObserved { get; set; }
    public int? TerminationError { get; set; }
    public bool ProductEntrypointExecuted => false;
    public bool ThreadResumed => false;
    public bool ChromiumTokenEquivalent => false;
}

internal static class Program
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    internal static readonly IReadOnlyDictionary<string, Original> Originals = new Dictionary<string, Original>(StringComparer.Ordinal)
    {
        ["3.7.8"] = new("1f7e25830864a04589805254d32c84c8ded7b0e8b2c74a0b7c11c2eee49e80da", 224089088),
        ["3.7.9"] = new("a031b05eb84a0526ca09e98f1ca1e9145567121190be6b83b5b3c2fe2805192b", 246368256)
    };

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
            if (args.Length != 2 || args[0] != "--run") throw new ArgumentException("Use --run <options.json> or --self-test.");
            // Reject the physical host before opening options or any product path.
            RequireHostedEnvironment();
            var options = JsonSerializer.Deserialize<Options>(File.ReadAllText(args[1]), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("Diagnostic options are missing.");
            return Run(options);
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    internal static string[] EnvironmentErrors(IReadOnlyDictionary<string, string?> environment, bool windows, bool administrator)
    {
        var errors = new List<string>();
        foreach (var pair in new Dictionary<string, string> { ["GITHUB_ACTIONS"]="true", ["CI"]="true", ["RUNNER_ENVIRONMENT"]="github-hosted",
            ["RUNNER_OS"]="Windows", ["GITHUB_REPOSITORY"]="egoist-ai1/egoist-lagom" })
            if (!environment.TryGetValue(pair.Key, out var actual) || actual != pair.Value) errors.Add(pair.Key);
        foreach (var name in new[] { "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT" })
            if (!environment.TryGetValue(name, out var value) || !Regex.IsMatch(value ?? "", "^[1-9][0-9]*$")) errors.Add(name);
        if (!environment.TryGetValue("GITHUB_SHA", out var sha) || !Regex.IsMatch(sha ?? "", "^[a-f0-9]{40}$")) errors.Add("GITHUB_SHA");
        if (!windows) errors.Add("Windows");
        if (!administrator) errors.Add("ElevatedAdministrator");
        return errors.ToArray();
    }

    private static void RequireHostedEnvironment()
    {
        var environment = new Dictionary<string, string?>();
        foreach (var name in new[] { "GITHUB_ACTIONS", "CI", "RUNNER_ENVIRONMENT", "RUNNER_OS", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA" })
            environment[name] = Environment.GetEnvironmentVariable(name);
        bool windows = OperatingSystem.IsWindows();
        bool administrator = windows && new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        var errors = EnvironmentErrors(environment, windows, administrator);
        if (errors.Length != 0) throw new InvalidOperationException("Legacy launch diagnostic hosted guard refused before product lookup: " + string.Join(", ", errors));
    }

    internal static Original RequireOriginal(string version, string sha)
    {
        if (!Originals.TryGetValue(version, out var original) || sha != original.Sha256)
            throw new InvalidDataException("Only the pinned authenticated original 3.7.8/3.7.9 GUI is permitted.");
        return original;
    }

    internal static string Within(string path, string root)
    {
        if (!Path.IsPathFullyQualified(path) || !Path.IsPathFullyQualified(root)) throw new InvalidDataException("Absolute diagnostic paths required.");
        var full = Path.GetFullPath(path); var parent = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        if (!full.StartsWith(parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Diagnostic path escaped its work root.");
        return full;
    }

    private static void Ordinary(string path, bool file)
    {
        string? current = Path.GetFullPath(path); bool first = true;
        while (!string.IsNullOrEmpty(current))
        {
            var attributes = File.GetAttributes(current);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Reparse diagnostic path refused.");
            if (first && ((attributes & FileAttributes.Directory) == 0) != file) throw new InvalidDataException("Diagnostic path type differs.");
            first = false; current = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(current));
        }
    }

    private static string Hash(Stream stream) { stream.Position = 0; return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); }

    private static int Run(Options options)
    {
        var original = RequireOriginal(options.ExpectedOldVersion, options.ExpectedGuiSha256);
        if (options.ExpectedSourceCommit != Environment.GetEnvironmentVariable("GITHUB_SHA")) throw new InvalidDataException("Actual GITHUB_SHA differs.");
        string runnerTemp = Environment.GetEnvironmentVariable("RUNNER_TEMP") ?? throw new InvalidDataException("RUNNER_TEMP missing.");
        Within(options.WorkRoot, runnerTemp); Within(options.EvidenceDirectory, runnerTemp); Within(options.EvidenceDirectory, options.WorkRoot);
        Within(options.ReceiptPath, options.EvidenceDirectory);
        Ordinary(runnerTemp, false); Ordinary(options.WorkRoot, false); Ordinary(options.EvidenceDirectory, false);
        string gui = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EgoistShield", "EgoistShield.exe");
        if (!string.Equals(Path.GetFullPath(options.InstalledGuiPath), gui, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Only canonical Program Files GUI allowed.");
        Ordinary(gui, true);
        if (Process.GetProcessesByName("EgoistShield").Length != 0) throw new InvalidOperationException("Diagnostic requires no existing GUI process.");
        using var lockedGui = new FileStream(gui, FileMode.Open, FileAccess.Read, FileShare.Read);
        string before = Hash(lockedGui);
        if (before != original.Sha256 || lockedGui.Length != original.Bytes) throw new InvalidDataException("Actual GUI bytes differ from pinned original.");
        string? productVersion = FileVersionInfo.GetVersionInfo(gui).ProductVersion;
        if (productVersion != options.ExpectedOldVersion && productVersion != options.ExpectedOldVersion + ".0") throw new InvalidDataException("Old product version differs.");
        var attempts = new List<Attempt>();
        TokenProof? runner = null; string? failure = null;
        var uac = ReadUac(); var layers = ReadLayers(gui);
        try
        {
            if (!Native.OpenProcessToken(Native.GetCurrentProcess(), 0x000B, out var current)) throw Native.Error("OpenProcessToken");
            using (current)
            {
                runner = ReadToken(current);
                Sample("current-primary", "DuplicateTokenEx(current, primary)", () => Duplicate(current), gui, attempts);
                Sample("linked-primary", "GetTokenInformation(TokenLinkedToken), DuplicateTokenEx(primary)", () => Linked(current), gui, attempts);
                Sample("restricted-primary", "CreateRestrictedToken(DISABLE_MAX_PRIVILEGE|LUA_TOKEN, Administrators denied); medium integrity", () => Restricted(current), gui, attempts);
            }
        }
        catch (Exception error) { failure = error.Message; }
        string after = Hash(lockedGui);
        if (after != before) failure = "Original GUI changed during diagnostic.";
        bool cleanupConfirmed = attempts.All(x => !x.ProcessCreated || x.OwnHeldProcessTerminated == true && x.OwnHeldProcessExitObserved == true);
        if (!cleanupConfirmed) failure ??= "Owned held child cleanup could not be confirmed.";
        var receipt = new { schemaVersion=1, kind="native-legacy-suspended-launch-boundary-diagnostic", result=failure is null ? "diagnostic-complete" : "diagnostic-failed",
            createdAtUtc=DateTimeOffset.UtcNow, expectedSourceCommit=options.ExpectedSourceCommit, originalVersion=options.ExpectedOldVersion,
            originalGui=new { path=gui, bytes=lockedGui.Length, sha256Before=before, sha256After=after, productVersion },
            host=new { runId=Environment.GetEnvironmentVariable("GITHUB_RUN_ID"), runAttempt=Environment.GetEnvironmentVariable("GITHUB_RUN_ATTEMPT"), runnerEnvironment="github-hosted", os=Environment.OSVersion.ToString() },
            api="CreateProcessAsUserW", applicationArguments=Array.Empty<string>(), creationFlags="CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|DETACHED_PROCESS",
            environment="inherited without application overrides", compatibilityLayer=Environment.GetEnvironmentVariable("__COMPAT_LAYER"), uac, layers, runnerToken=runner, attempts,
            cleanupConfirmed, failure, acceptance=false, guiAcceptance=false, productEntrypointExecuted=false, threadsResumed=0, actualChromiumGpuErrorCaptured=false,
            chromiumTokenEquivalent=false, scmMutations=0, networkMutations=0, registryWrites=0,
            limits=new[] { "A sampled token is not Chromium's actual lockdown/AppContainer token or complete launch policy.",
                "A successful suspended creation proves only pre-execution process creation; no GUI or helper functionality ran.",
                "Native failures are immediate errors of these sampled CreateProcessAsUserW calls, not proof of the recorded GPU child's exact error.",
                "The ordinary unchanged old GUI/UIA/Telegram/helper upgrade acceptance remains mandatory." } };
        using (var destination = new FileStream(options.ReceiptPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            JsonSerializer.Serialize(destination, receipt, Json);
        Console.WriteLine(JsonSerializer.Serialize(new { receiptPath=options.ReceiptPath, receipt.result, acceptance=false, actualChromiumGpuErrorCaptured=false }));
        return failure is null ? 0 : 1;
    }

    private static void Sample(string name, string method, Func<SafeAccessTokenHandle> obtain, string gui, List<Attempt> attempts)
    {
        var attempt = new Attempt { Sample=name, TokenMethod=method, Stage="token" }; attempts.Add(attempt);
        try
        {
            using var token = obtain(); attempt.Token = ReadToken(token); attempt.Stage="CreateProcessAsUserW";
            CreateSuspended(token, gui, attempt); attempt.Stage="complete";
        }
        catch (Win32Exception error) { attempt.Win32Error ??= error.NativeErrorCode; attempt.ErrorMessage=error.Message; }
        catch (Exception error) { attempt.ErrorMessage=error.Message; }
        if (attempt.ProcessCreated && attempt.OwnHeldProcessExitObserved != true) throw new IOException("Owned suspended process cleanup failed; stop further attempts.");
    }

    private static SafeAccessTokenHandle Duplicate(SafeAccessTokenHandle source)
    {
        if (!Native.DuplicateTokenEx(source, 0x02000000, IntPtr.Zero, 2, 1, out var duplicate)) throw Native.Error("DuplicateTokenEx primary");
        return duplicate;
    }

    private static SafeAccessTokenHandle Linked(SafeAccessTokenHandle source)
    {
        using var data = Query(source, 19);
        using var linked = new SafeAccessTokenHandle(Marshal.ReadIntPtr(data.Pointer));
        return Duplicate(linked);
    }

    private static SafeAccessTokenHandle Restricted(SafeAccessTokenHandle source)
    {
        using var administrators = new SidBuffer("S-1-5-32-544");
        var denied = new[] { new SidAndAttributes { Sid=administrators.Pointer, Attributes=0 } };
        if (!Native.CreateRestrictedToken(source, 5, 1, denied, 0, IntPtr.Zero, 0, IntPtr.Zero, out var token)) throw Native.Error("CreateRestrictedToken");
        try
        {
            using var medium = new SidBuffer("S-1-16-8192"); var label = new SidAndAttributes { Sid=medium.Pointer, Attributes=0x20 };
            if (!Native.SetTokenInformation(token, 25, ref label, (uint)(Marshal.SizeOf<SidAndAttributes>() + medium.Length))) throw Native.Error("SetTokenInformation medium integrity");
            return token;
        }
        catch { token.Dispose(); throw; }
    }

    private static TokenProof ReadToken(SafeAccessTokenHandle token)
    {
        using var user = Query(token, 1); using var groups = Query(token, 2); using var privileges = Query(token, 3);
        using var type = Query(token, 8); using var session = Query(token, 12); using var elevationType = Query(token, 18);
        using var elevation = Query(token, 20); using var integrity = Query(token, 25);
        uint count = (uint)Marshal.ReadInt32(groups.Pointer); if (count > 1024) throw new InvalidDataException("Token group bound exceeded.");
        bool present=false, enabled=false, deny=false;
        for (int index=0; index<count; index++)
        {
            var entry = Marshal.PtrToStructure<SidAndAttributes>(IntPtr.Add(groups.Pointer, IntPtr.Size + index * Marshal.SizeOf<SidAndAttributes>()));
            if (new SecurityIdentifier(entry.Sid).Value == "S-1-5-32-544") { present=true; enabled=(entry.Attributes & 4)!=0; deny=(entry.Attributes & 0x10)!=0; }
        }
        var privilegeProof = new List<Privilege>(); uint privilegeCount=(uint)Marshal.ReadInt32(privileges.Pointer);
        if (privilegeCount > 128) throw new InvalidDataException("Token privilege bound exceeded.");
        for (int index=0; index<privilegeCount; index++)
        {
            var entry=Marshal.PtrToStructure<LuidAndAttributes>(IntPtr.Add(privileges.Pointer, 4 + index * Marshal.SizeOf<LuidAndAttributes>()));
            var buffer=new StringBuilder(256); uint length=256;
            if (!Native.LookupPrivilegeName(null, ref entry.Luid, buffer, ref length)) throw Native.Error("LookupPrivilegeName");
            privilegeProof.Add(new Privilege(buffer.ToString(), entry.Attributes));
        }
        return new TokenProof(new SecurityIdentifier(Marshal.ReadIntPtr(user.Pointer)).Value, new SecurityIdentifier(Marshal.ReadIntPtr(integrity.Pointer)).Value,
            Marshal.ReadInt32(type.Pointer), Marshal.ReadInt32(elevationType.Pointer), Marshal.ReadInt32(elevation.Pointer)!=0, Marshal.ReadInt32(session.Pointer),
            Native.IsTokenRestricted(token), present, enabled, deny, privilegeProof);
    }

    private static NativeBuffer Query(SafeAccessTokenHandle token, int kind)
    {
        Native.GetTokenInformation(token, kind, IntPtr.Zero, 0, out uint length);
        int error=Marshal.GetLastPInvokeError();
        if (length == 0 || length > 131072) throw new Win32Exception(error, "Token query size invalid.");
        var data=new NativeBuffer((int)length);
        if (!Native.GetTokenInformation(token, kind, data.Pointer, length, out _)) { error=Marshal.GetLastPInvokeError(); data.Dispose(); throw new Win32Exception(error, "GetTokenInformation kind="+kind); }
        return data;
    }

    private static void CreateSuspended(SafeAccessTokenHandle token, string gui, Attempt attempt)
    {
        using var job=Native.CreateJobObject(IntPtr.Zero, null);
        if (job.IsInvalid) throw Native.Error("CreateJobObject");
        var limits=new JobExtendedLimits(); limits.BasicLimitInformation.LimitFlags=0x2000;
        if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<JobExtendedLimits>())) throw Native.Error("SetInformationJobObject kill-on-close");
        var startup=new StartupInfo { Size=(uint)Marshal.SizeOf<StartupInfo>() };
        // No ResumeThread exists in this diagnostic: even successful calls are destroyed before execution.
        bool created=Native.CreateProcessAsUser(token, gui, new StringBuilder('"'+gui+'"'), IntPtr.Zero, IntPtr.Zero, false,
            0x00000004 | 0x00000400 | 0x00000008, IntPtr.Zero, Path.GetDirectoryName(gui)!, ref startup, out var info);
        int nativeError=Marshal.GetLastPInvokeError(); // Capture immediately before any other P/Invoke.
        attempt.ProcessCreated=created; attempt.RawLastPInvokeError=nativeError;
        if (!created) { attempt.Win32Error=nativeError; attempt.ErrorMessage=new Win32Exception(nativeError).Message; return; }
        using var process=new KernelHandle(info.Process); using var thread=new KernelHandle(info.Thread);
        attempt.ProcessId=info.ProcessId;
        try
        {
            if (!Native.AssignProcessToJobObject(job, process)) attempt.JobAssignmentError=Marshal.GetLastPInvokeError();
            var heldPath=new StringBuilder(32768); uint size=32768;
            if (!Native.QueryFullProcessImageName(process, 0, heldPath, ref size)) throw Native.Error("QueryFullProcessImageName held child");
            attempt.HeldProcessPath=heldPath.ToString();
            if (!string.Equals(attempt.HeldProcessPath, gui, StringComparison.OrdinalIgnoreCase)) throw new IOException("Held child path differs from authenticated GUI.");
        }
        finally
        {
            bool terminated=Native.TerminateProcess(process, 0); int terminateError=Marshal.GetLastPInvokeError();
            if (!terminated) { attempt.TerminationError=terminateError; Native.TerminateJobObject(job, 0); }
            uint waited=Native.WaitForSingleObject(process, 5000);
            bool exited=waited == 0 && Native.GetExitCodeProcess(process, out uint code) && code != 259;
            attempt.OwnHeldProcessTerminated=terminated || exited; attempt.OwnHeldProcessExitObserved=exited;
        }
    }

    private static object ReadUac()
    {
        using var hive=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var key=hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", false);
        return new { enableLUA=key?.GetValue("EnableLUA"), consentPromptBehaviorAdmin=key?.GetValue("ConsentPromptBehaviorAdmin"), filterAdministratorToken=key?.GetValue("FilterAdministratorToken") };
    }
    private static object[] ReadLayers(string gui)
    {
        var rows=new List<object>();
        foreach(var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            foreach(var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                using var root=RegistryKey.OpenBaseKey(hive, view); using var key=root.OpenSubKey(@"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers", false);
                rows.Add(new { hive=hive.ToString(), view=view.ToString(), value=key?.GetValue(gui, null, RegistryValueOptions.DoNotExpandEnvironmentNames) });
            }
        return rows.ToArray();
    }

    private static int SelfTest()
    {
        int checks=0;
        void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); checks++; }
        var valid=new Dictionary<string,string?> { ["GITHUB_ACTIONS"]="true", ["CI"]="true", ["RUNNER_ENVIRONMENT"]="github-hosted", ["RUNNER_OS"]="Windows", ["GITHUB_REPOSITORY"]="egoist-ai1/egoist-lagom", ["GITHUB_RUN_ID"]="1", ["GITHUB_RUN_ATTEMPT"]="1", ["GITHUB_SHA"]=new string('a',40) };
        Check(EnvironmentErrors(valid,true,true).Length==0,"Valid pure host contract rejected.");
        foreach(var name in valid.Keys) { var invalid=new Dictionary<string,string?>(valid); invalid[name]=""; Check(EnvironmentErrors(invalid,true,true).Contains(name),"Missing host field admitted."); }
        Check(EnvironmentErrors(valid,false,true).Contains("Windows"),"Non-Windows admitted."); Check(EnvironmentErrors(valid,true,false).Contains("ElevatedAdministrator"),"Non-admin admitted.");
        foreach(var pair in Originals) { Check(RequireOriginal(pair.Key,pair.Value.Sha256).Bytes==pair.Value.Bytes,"Pinned map mismatch."); try { RequireOriginal(pair.Key,new string('0',64)); throw new Exception("Tampered pin admitted."); } catch(InvalidDataException) { checks++; } }
        try { RequireOriginal("3.8.0",Originals["3.7.9"].Sha256); throw new Exception("Candidate used as legacy."); } catch(InvalidDataException) { checks++; }
        Check(Within(@"C:\owned\nested\evidence",@"C:\owned")==@"C:\owned\nested\evidence","Valid boundary rejected.");
        foreach(var path in new[] { @"C:\owned-other\file", @"C:\owned\..\foreign\file", "relative" }) { try { Within(path,@"C:\owned"); throw new Exception("Boundary escape admitted."); } catch(InvalidDataException) { checks++; } }
        Console.WriteLine(JsonSerializer.Serialize(new { kind="managed-legacy-launch-diagnostic-self-test", checks, nativeCalls=0, productLookup=false, acceptance=false })); return 0;
    }
}

internal sealed class NativeBuffer : IDisposable
{
    public IntPtr Pointer { get; private set; }
    public NativeBuffer(int length) { Pointer=Marshal.AllocHGlobal(length); }
    public void Dispose() { if(Pointer!=IntPtr.Zero){Marshal.FreeHGlobal(Pointer);Pointer=IntPtr.Zero;} }
}
internal sealed class SidBuffer : IDisposable
{
    public IntPtr Pointer { get; }
    public int Length { get; }
    public SidBuffer(string text) { var sid=new SecurityIdentifier(text); Length=sid.BinaryLength; var bytes=new byte[Length];sid.GetBinaryForm(bytes,0);Pointer=Marshal.AllocHGlobal(Length);Marshal.Copy(bytes,0,Pointer,Length); }
    public void Dispose() => Marshal.FreeHGlobal(Pointer);
}
internal sealed class KernelHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    public KernelHandle() : base(true) { }
    public KernelHandle(IntPtr handle) : base(true) { SetHandle(handle); }
    protected override bool ReleaseHandle() => Native.CloseHandle(handle);
}
[StructLayout(LayoutKind.Sequential)] internal struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
[StructLayout(LayoutKind.Sequential)] internal struct Luid { public uint Low; public int High; }
[StructLayout(LayoutKind.Sequential)] internal struct LuidAndAttributes { public Luid Luid; public uint Attributes; }
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] internal struct StartupInfo
{
    public uint Size; public string? Reserved; public string? Desktop; public string? Title;
    public uint X,Y,XSize,YSize,XCountChars,YCountChars,FillAttribute,Flags; public ushort ShowWindow,ReservedBytes;
    public IntPtr ReservedPointer,StandardInput,StandardOutput,StandardError;
}
[StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation { public IntPtr Process,Thread; public uint ProcessId,ThreadId; }
[StructLayout(LayoutKind.Sequential)] internal struct JobBasicLimits { public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass; }
[StructLayout(LayoutKind.Sequential)] internal struct IoCounters { public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount; }
[StructLayout(LayoutKind.Sequential)] internal struct JobExtendedLimits { public JobBasicLimits BasicLimitInformation;public IoCounters IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed; }
internal static class Native
{
    internal static Win32Exception Error(string stage) => new(Marshal.GetLastPInvokeError(),stage);
    [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll",SetLastError=true)] internal static extern bool OpenProcessToken(IntPtr process,uint access,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",SetLastError=true)] internal static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,IntPtr data,uint length,out uint needed);
    [DllImport("advapi32.dll",SetLastError=true)] internal static extern bool DuplicateTokenEx(SafeAccessTokenHandle token,uint access,IntPtr attributes,int level,int type,out SafeAccessTokenHandle result);
    [DllImport("advapi32.dll",SetLastError=true)] internal static extern bool CreateRestrictedToken(SafeAccessTokenHandle token,uint flags,uint count,[In] SidAndAttributes[] denied,uint deletedCount,IntPtr deleted,uint restrictedCount,IntPtr restricted,out SafeAccessTokenHandle result);
    [DllImport("advapi32.dll",SetLastError=true)] internal static extern bool SetTokenInformation(SafeAccessTokenHandle token,int kind,ref SidAndAttributes data,uint length);
    [DllImport("advapi32.dll")] internal static extern bool IsTokenRestricted(SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool LookupPrivilegeName(string? system,ref Luid luid,StringBuilder name,ref uint length);
    [DllImport("advapi32.dll",EntryPoint="CreateProcessAsUserW",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool CreateProcessAsUser(SafeAccessTokenHandle token,string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInformation info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern KernelHandle CreateJobObject(IntPtr attributes,string? name);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool SetInformationJobObject(KernelHandle job,int kind,ref JobExtendedLimits data,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool AssignProcessToJobObject(KernelHandle job,KernelHandle process);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool TerminateProcess(KernelHandle process,uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool TerminateJobObject(KernelHandle job,uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern uint WaitForSingleObject(KernelHandle handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetExitCodeProcess(KernelHandle process,out uint code);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool QueryFullProcessImageName(KernelHandle process,uint flags,StringBuilder path,ref uint length);
    [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool CloseHandle(IntPtr handle);
}
