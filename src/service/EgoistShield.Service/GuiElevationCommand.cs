using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace EgoistShield.Service;

// Public launcher accepts startup preferences only. Every executable, cwd and
// trust root is derived from the protected installed native command itself.
internal static class GuiElevationCommand
{
    internal const string Flag = "--launch-elevated-gui";
    internal const string PrivilegeFlag = "--gui-startup-privilege";
    internal static Task<int> CheckPrivilegeAsync()
    {
        try
        {
            string executable = Environment.ProcessPath ?? throw new UnauthorizedAccessException();
            string root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(executable)!, "..", "..", ".."));
            string helper = Path.Combine(root, "resources", "core-service", "win-x64", "EgoistShield.Service.exe");
            if (!executable.Equals(helper, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException();
            using var lease = ProtectedExecutable.OpenHost(root, "cli");
            using var process = Process.GetCurrentProcess();
            GuiPrivilege privilege = GuiPrivilegePolicy.Read(process);
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, admitted = privilege.Allowed && process.SessionId > 0, canRequestElevation = !privilege.Restricted && privilege.IntegrityRid >= 0x2000 && process.SessionId > 0 }, JsonDefaults.Options));
            return Task.FromResult(0);
        }
        catch
        {
            Console.WriteLine(JsonSerializer.Serialize(new { ok = false, code = "GUI_PRIVILEGE_UNVERIFIED" }, JsonDefaults.Options));
            return Task.FromResult(1);
        }
    }
    internal static Task<int> RunAsync(string[] arguments)
    {
        try
        {
            string executable = Environment.ProcessPath ?? throw new UnauthorizedAccessException("Launcher identity is unavailable.");
            string root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(executable)!, "..", "..", ".."));
            string helper = Path.Combine(root, "resources", "core-service", "win-x64", "EgoistShield.Service.exe");
            string gui = Path.Combine(root, "EgoistShield.exe");
            if (!executable.Equals(helper, StringComparison.OrdinalIgnoreCase) || arguments.Length < 1 || arguments[0] != Flag)
                throw new UnauthorizedAccessException("GUI elevation requires the protected installed command.");
            string[] preferences = arguments.Skip(1).ToArray();
            GuiLaunchPolicy.RequireArguments(new[] { gui }.Concat(preferences).ToArray());
            using var current = Process.GetCurrentProcess();
            var startupClock = Stopwatch.StartNew();
            double startupAge = Math.Max(0, (DateTime.UtcNow - current.StartTime.ToUniversalTime()).TotalSeconds);
            using var cliLease = ProtectedExecutable.OpenHost(root, "cli");
            using var guiLease = ProtectedExecutable.OpenHost(root, "gui");
            GuiPrivilege privilege = GuiPrivilegePolicy.Read(current);
            if (current.SessionId == 0 || privilege.Restricted || privilege.IntegrityRid < 0x2000)
                throw new UnauthorizedAccessException("GUI elevation requires an ordinary interactive user process.");
            if (!privilege.Allowed)
            {
                // Standard UAC only; cancellation never falls back to a plain GUI.
                var start = new ProcessStartInfo(helper)
                {
                    UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = root, Arguments = string.Join(" ", arguments)
                };
                using var elevated = Process.Start(start) ?? throw new InvalidOperationException("UAC did not return a launcher process.");
                if (!elevated.WaitForExit(30000)) throw new TimeoutException("The elevated GUI launcher did not finish within its startup budget.");
                if (elevated.ExitCode != 0) throw new InvalidOperationException("The elevated launcher rejected GUI startup.");
                Console.WriteLine(JsonSerializer.Serialize(new { ok = true, phase = "elevated-launcher-completed" }, JsonDefaults.Options));
                return Task.FromResult(0);
            }
            double remaining = 12 - startupAge - startupClock.Elapsed.TotalSeconds;
            if (remaining <= 0) throw new TimeoutException("GUI startup deadline expired before creation.");
            StartVerifiedGui(gui, root, preferences, current.SessionId, TimeSpan.FromSeconds(remaining));
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, phase = "started" }, JsonDefaults.Options));
            return Task.FromResult(0);
        }
        catch (Win32Exception error) when (error.NativeErrorCode == 1223)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { ok = false, cancelled = true, code = "UAC_CANCELLED" }, JsonDefaults.Options));
            return Task.FromResult(2);
        }
        catch (Exception)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { ok = false, cancelled = false, code = "GUI_START_REJECTED" }, JsonDefaults.Options));
            return Task.FromResult(1);
        }
    }

    private static void StartVerifiedGui(string gui, string root, string[] arguments, int session, TimeSpan remaining)
    {
        var deadlineClock = Stopwatch.StartNew();
        var startup = new StartupInfo { Size = (uint)Marshal.SizeOf<StartupInfo>() };
        var command = new StringBuilder('"' + gui + '"' + (arguments.Length > 0 ? " " + string.Join(" ", arguments) : ""));
        var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            string key = (string)entry.Key;
            if (key.StartsWith("DOTNET_", StringComparison.OrdinalIgnoreCase) || key.StartsWith("COMPLUS_", StringComparison.OrdinalIgnoreCase) ||
                key.StartsWith("CORECLR_", StringComparison.OrdinalIgnoreCase) || key.StartsWith("COR_", StringComparison.OrdinalIgnoreCase) ||
                key.StartsWith("NODE_", StringComparison.OrdinalIgnoreCase) || key.StartsWith("ELECTRON_", StringComparison.OrdinalIgnoreCase) ||
                key.StartsWith("OPENSSL_", StringComparison.OrdinalIgnoreCase) || key.StartsWith("LAGOM_TEST_", StringComparison.OrdinalIgnoreCase)) continue;
            environment[key] = (string?)entry.Value ?? "";
        }
        string block = string.Join('\0', environment.Select(entry => entry.Key + "=" + entry.Value)) + "\0\0";
        IntPtr nativeEnvironment = Marshal.StringToHGlobalUni(block);
        ProcessInformation child = default;
        bool resumed = false;
        try
        {
            if (!CreateProcess(gui, command, IntPtr.Zero, IntPtr.Zero, false, 0x00000004 | 0x00000400 | 0x08000000, nativeEnvironment, root, ref startup, out child))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot create the protected GUI.");
            // Native handles keep the suspended child identity stable through admission.
            var image = new StringBuilder(32768);
            uint characters = (uint)image.Capacity;
            if (!QueryFullProcessImageName(child.Process, 0, image, ref characters) || !image.ToString().Equals(gui, StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException("Created GUI image did not match the protected executable.");
            using var captured = Process.GetProcessById((int)child.ProcessId);
            _ = captured.Handle;
            if (captured.HasExited || captured.SessionId != session) throw new UnauthorizedAccessException("Created GUI session changed.");
            GuiPrivilegePolicy.Require(captured);
            if (deadlineClock.Elapsed >= remaining) throw new TimeoutException("GUI startup deadline expired before resume.");
            if (ResumeThread(child.Thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot resume the verified GUI.");
            resumed = true;
        }
        finally
        {
            bool retirementConfirmed = true;
            try
            {
                if (!resumed && child.Process != IntPtr.Zero && WaitForSingleObject(child.Process, 0) != 0)
                {
                    bool terminated = TerminateProcess(child.Process, 64);
                    retirementConfirmed = (terminated || WaitForSingleObject(child.Process, 0) == 0) && WaitForSingleObject(child.Process, 5000) == 0;
                }
            }
            finally
            {
                if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
                if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
                Marshal.FreeHGlobal(nativeEnvironment);
            }
            if (!retirementConfirmed) throw new InvalidOperationException("Suspended GUI retirement could not be confirmed.");
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo
    {
        internal uint Size; internal string? Reserved; internal string? Desktop; internal string? Title;
        internal uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        internal ushort ShowWindow, ReservedLength; internal IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation child);
    [DllImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder image, ref uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint exit);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}