using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

internal sealed class ServiceRecoveryReadException : IOException
{
    internal string Stage { get; }
    internal int? NativeError { get; }
    internal ServiceRecoveryReadException(string stage, int? nativeError = null, Exception? cause = null)
        : base("Service recovery read failed at " + stage + (nativeError.HasValue ? "; win32=" + nativeError.Value : ""), cause)
    { Stage = stage; NativeError = nativeError; }
}

internal static class WindowsServiceRecoverySnapshot
{
    internal const string TelegramServiceName = "EgoistShieldTelegramProxy";
    private const int MaxBuffer = 8192;
    internal sealed record Action(uint Type, uint DelayMs);
    internal sealed record Observation(string ServiceName, bool Installed, uint ServiceType, uint StartType,
        string BinaryCommand, string Account, bool DelayedAutoStart, uint ResetPeriodSeconds,
        Action[] Actions, bool FailureActionsOnNonCrashFailures);
    [StructLayout(LayoutKind.Sequential)] private struct Config
    {
        public uint ServiceType, StartType, ErrorControl;
        public IntPtr BinaryPath, LoadOrderGroup;
        public uint TagId;
        public IntPtr Dependencies, Account, DisplayName;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct FailureConfig
    {
        public uint ResetPeriod;
        public IntPtr RebootMessage, Command;
        public uint Count;
        public IntPtr Actions;
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativeAction { public uint Type, Delay; }
    private sealed class ServiceHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        private ServiceHandle() : base(true) { }
        protected override bool ReleaseHandle() => CloseServiceHandle(handle);
    }

    internal static Observation Read(string serviceName, CancellationToken token)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        token.ThrowIfCancellationRequested();
        using var scm = OpenSCManagerW(null, null, 1); // SC_MANAGER_CONNECT only.
        if (scm.IsInvalid) throw NativeFailure("open-scm");
        using var service = OpenServiceW(scm, serviceName, 1); // SERVICE_QUERY_CONFIG only.
        if (service.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            if (error != 1060) throw new ServiceRecoveryReadException("open-service", error);
            token.ThrowIfCancellationRequested();
            using var confirmMissing = OpenServiceW(scm, serviceName, 1);
            if (!confirmMissing.IsInvalid || Marshal.GetLastWin32Error() != 1060)
                throw new ServiceRecoveryReadException("unstable-service-existence");
            token.ThrowIfCancellationRequested();
            return new Observation(serviceName, false, 0, 0, "", "", false, 0, Array.Empty<Action>(), false);
        }
        // A held service handle prevents reuse of its deleted name. Every field below is
        // read twice from that same handle; concurrent policy changes remain unavailable.
        var first = ReadOnce(service, serviceName, token);
        var second = ReadOnce(service, serviceName, token);
        if (!Equivalent(first, second)) throw new ServiceRecoveryReadException("unstable-policy");
        using var confirmPresent = OpenServiceW(scm, serviceName, 1);
        if (confirmPresent.IsInvalid) throw NativeFailure("confirm-service");
        token.ThrowIfCancellationRequested();
        return second;
    }

    internal static bool Equivalent(Observation a, Observation b) => a.ServiceName == b.ServiceName &&
        a.Installed == b.Installed && a.ServiceType == b.ServiceType && a.StartType == b.StartType &&
        string.Equals(a.BinaryCommand, b.BinaryCommand, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(a.Account, b.Account, StringComparison.OrdinalIgnoreCase) &&
        a.DelayedAutoStart == b.DelayedAutoStart && a.ResetPeriodSeconds == b.ResetPeriodSeconds &&
        a.FailureActionsOnNonCrashFailures == b.FailureActionsOnNonCrashFailures && a.Actions.SequenceEqual(b.Actions);

    internal static void VerifyTelegramIdentity(Observation value, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (value.ServiceName != TelegramServiceName || !value.Installed || value.ServiceType != 16 ||
            !(value.Account.Equals("LocalSystem", StringComparison.OrdinalIgnoreCase) ||
              value.Account.Equals(@"NT AUTHORITY\SYSTEM", StringComparison.OrdinalIgnoreCase)))
            throw new ServiceRecoveryReadException("service-identity");
        string root = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        if (!Path.IsPathFullyQualified(root)) throw new ServiceRecoveryReadException("service-identity-root");
        string expected = Path.Combine(root, "EgoistShield", "Runtime", "TelegramProxy", "service-wrapper", "egoistshield-telegram-proxy-service.exe");
        string command = value.BinaryCommand.Trim();
        if (!command.Equals(expected, StringComparison.OrdinalIgnoreCase) &&
            !command.Equals("\"" + expected + "\"", StringComparison.OrdinalIgnoreCase))
            throw new ServiceRecoveryReadException("service-identity-image");
        try { TrustedPath.AssertExistingFileUnderRoots(expected, Path.Combine(root, "EgoistShield")); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        { throw new ServiceRecoveryReadException("service-identity-path", cause: error); }
        token.ThrowIfCancellationRequested();
    }

    private static Observation ReadOnce(ServiceHandle service, string serviceName, CancellationToken token)
    {
        var basic = ReadBuffer(service, 0, "basic-config", token, (buffer, size) =>
        {
            if (size < Marshal.SizeOf<Config>()) throw new ServiceRecoveryReadException("basic-config-size");
            var config = Marshal.PtrToStructure<Config>(buffer);
            if (config.StartType > 4) throw new ServiceRecoveryReadException("basic-start-type");
            return (config.ServiceType, config.StartType, ReadString(buffer, size, config.BinaryPath), ReadString(buffer, size, config.Account));
        });
        var failure = ReadBuffer(service, 2, "failure-actions", token, DecodeFailure);
        bool delayed = ReadBuffer(service, 3, "delayed-auto-start", token, DecodeBoolean);
        bool flag = ReadBuffer(service, 4, "failure-actions-flag", token, DecodeBoolean);
        return new Observation(serviceName, true, basic.ServiceType, basic.StartType, basic.Item3, basic.Item4,
            delayed, failure.Reset, failure.Actions, flag);
    }

    internal static (uint Reset, Action[] Actions) DecodeFailure(IntPtr buffer, int size)
    {
        if (size < Marshal.SizeOf<FailureConfig>()) throw new ServiceRecoveryReadException("failure-actions-size");
        var config = Marshal.PtrToStructure<FailureConfig>(buffer);
        if (config.Count > 128) throw new ServiceRecoveryReadException("failure-actions-count");
        if (config.Count == 0) return (config.ResetPeriod, Array.Empty<Action>());
        int rowSize = Marshal.SizeOf<NativeAction>();
        AssertRange(buffer, size, config.Actions, checked((int)config.Count * rowSize), "failure-actions-range");
        var actions = new Action[config.Count];
        for (int index = 0; index < actions.Length; index++)
        {
            var row = Marshal.PtrToStructure<NativeAction>(IntPtr.Add(config.Actions, index * rowSize));
            if (row.Type > 3) throw new ServiceRecoveryReadException("failure-actions-type");
            actions[index] = new Action(row.Type, row.Delay);
        }
        return (config.ResetPeriod, actions);
    }

    internal static bool DecodeBoolean(IntPtr buffer, int size)
    {
        if (size < 4) throw new ServiceRecoveryReadException("flag-size");
        int flag = Marshal.ReadInt32(buffer);
        if (flag is not 0 and not 1) throw new ServiceRecoveryReadException("flag-value");
        return flag == 1;
    }

    private static string ReadString(IntPtr buffer, int size, IntPtr value)
    {
        AssertRange(buffer, size, value, 2, "config-string-range");
        long offset = value.ToInt64() - buffer.ToInt64();
        int maxChars = (size - checked((int)offset)) / 2;
        for (int index = 0; index < maxChars; index++)
            if (Marshal.ReadInt16(value, index * 2) == 0) return Marshal.PtrToStringUni(value, index)!;
        throw new ServiceRecoveryReadException("config-string-termination");
    }

    private static void AssertRange(IntPtr buffer, int size, IntPtr value, int count, string stage)
    {
        long offset = value.ToInt64() - buffer.ToInt64();
        if (value == IntPtr.Zero || offset < 0 || count < 0 || offset > size || count > size - offset)
            throw new ServiceRecoveryReadException(stage);
    }

    private static T ReadBuffer<T>(ServiceHandle service, uint level, string stage, CancellationToken token, Func<IntPtr, int, T> decode)
    {
        token.ThrowIfCancellationRequested();
        bool probe = Query(service, level, IntPtr.Zero, 0, out uint needed);
        int error = Marshal.GetLastWin32Error();
        if (probe || error != 122) throw new ServiceRecoveryReadException(stage + "-probe", error);
        for (int attempt = 0; attempt < 3; attempt++)
        {
            token.ThrowIfCancellationRequested();
            if (needed < 4 || needed > MaxBuffer) throw new ServiceRecoveryReadException(stage + "-bound");
            int size = checked((int)needed);
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                bool success = Query(service, level, buffer, needed, out uint next);
                error = Marshal.GetLastWin32Error();
                token.ThrowIfCancellationRequested();
                if (success) return decode(buffer, size);
                if (error != 122) throw new ServiceRecoveryReadException(stage, error);
                needed = next;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        throw new ServiceRecoveryReadException(stage + "-unstable-size", 122);
    }

    private static bool Query(ServiceHandle service, uint level, IntPtr buffer, uint size, out uint needed) =>
        level == 0 ? QueryServiceConfigW(service, buffer, size, out needed) : QueryServiceConfig2W(service, level, buffer, size, out needed);
    private static ServiceRecoveryReadException NativeFailure(string stage) => new(stage, Marshal.GetLastWin32Error());
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern ServiceHandle OpenSCManagerW(string? machineName, string? databaseName, uint access);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern ServiceHandle OpenServiceW(ServiceHandle scm, string serviceName, uint access);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseServiceHandle(IntPtr service);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryServiceConfigW(ServiceHandle service, IntPtr buffer, uint size, out uint needed);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryServiceConfig2W(ServiceHandle service, uint level, IntPtr buffer, uint size, out uint needed);
}
