using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace EgoistShield.Service;

// Canonical bytes alone cannot distinguish the interactive main process from
// Electron's renderer/utility children or a GUI launched with remote debugging.
internal static class GuiLaunchPolicy
{
    private const int ProcessCommandLineInformation = 60;
    private const int MaximumCommandLineBytes = 65536;

    internal static void RequireMainProcess(Process process)
    {
        string commandLine = ReadCommandLine(process);
        string[] arguments = ParseCommandLine(commandLine);
        RequireArguments(arguments);
    }

    internal static void RequireArguments(string[] arguments)
    {
        if (arguments.Length is < 1 or > 3 || string.IsNullOrWhiteSpace(arguments[0]))
            throw new UnauthorizedAccessException("The installed GUI must use its normal startup command.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 1; index < arguments.Length; index++)
            if (arguments[index] is not ("--minimized" or "--background") || !seen.Add(arguments[index]))
                throw new UnauthorizedAccessException("GUI debugging, alternate applications and child-process arguments cannot authorize Core operations.");
    }

    internal static string[] ParseCommandLine(string commandLine)
    {
        if (commandLine.Length is < 1 or > MaximumCommandLineBytes / 2 || commandLine.Contains('\0'))
            throw new UnauthorizedAccessException("GUI command line is unavailable or exceeds its limit.");
        IntPtr values = CommandLineToArgv(commandLine, out int count);
        if (values == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot parse GUI command line.");
        try
        {
            if (count is < 1 or > 16384) throw new UnauthorizedAccessException("GUI argument count is invalid.");
            var result = new string[count];
            for (int index = 0; index < count; index++)
                result[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(values, checked(index * IntPtr.Size))) ??
                    throw new UnauthorizedAccessException("GUI argument is unavailable.");
            return result;
        }
        finally { LocalFree(values); }
    }

    private static string ReadCommandLine(Process process)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        DateTime startedAt = process.StartTime;
        int status = NtQueryInformationProcess(process.Handle, ProcessCommandLineInformation, IntPtr.Zero, 0, out int required);
        if (required < Marshal.SizeOf<UnicodeString>() || required > MaximumCommandLineBytes + Marshal.SizeOf<UnicodeString>())
            throw new UnauthorizedAccessException("GUI command line size could not be verified.");
        IntPtr buffer = Marshal.AllocHGlobal(required);
        try
        {
            status = NtQueryInformationProcess(process.Handle, ProcessCommandLineInformation, buffer, required, out int read);
            if (status < 0 || read > required) throw new UnauthorizedAccessException("GUI command line could not be read from its native process.");
            UnicodeString value = Marshal.PtrToStructure<UnicodeString>(buffer);
            long offset = value.Buffer.ToInt64() - buffer.ToInt64();
            if (value.Length is 0 || value.Length % 2 != 0 || value.Length > value.MaximumLength ||
                offset < Marshal.SizeOf<UnicodeString>() || offset > required - value.Length)
                throw new UnauthorizedAccessException("GUI command line native buffer is invalid.");
            string result = Marshal.PtrToStringUni(value.Buffer, value.Length / 2) ?? throw new UnauthorizedAccessException("GUI command line is unavailable.");
            process.Refresh();
            if (process.HasExited || process.StartTime != startedAt) throw new UnauthorizedAccessException("GUI process changed while its command line was verified.");
            return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    [StructLayout(LayoutKind.Sequential)] private struct UnicodeString
    { internal ushort Length, MaximumLength; internal IntPtr Buffer; }
    [DllImport("ntdll.dll", ExactSpelling = true)]
    private static extern int NtQueryInformationProcess(IntPtr process, int informationClass, IntPtr information, int informationLength, out int returnLength);
    [DllImport("shell32.dll", EntryPoint = "CommandLineToArgvW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CommandLineToArgv(string commandLine, out int arguments);
    [DllImport("kernel32.dll", ExactSpelling = true)] private static extern IntPtr LocalFree(IntPtr memory);
}
