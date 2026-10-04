using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace EgoistShield.Service;

internal sealed record GuiPrivilege(bool Elevated, bool Administrator, bool Restricted, uint IntegrityRid)
{
    internal bool Allowed => Elevated && Administrator && !Restricted && IntegrityRid >= 0x3000;
}

internal static class GuiPrivilegePolicy
{
    internal static GuiPrivilege Read(Process process)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (!OpenProcessToken(process.Handle, 10, out IntPtr token)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot inspect the GUI access token.");
        try
        {
            if (!GetTokenInformation(token, 20, out int elevation, sizeof(int), out int read) || read != sizeof(int))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot verify GUI token elevation.");
            GetTokenInformationBuffer(token, 25, IntPtr.Zero, 0, out int required);
            if (required < IntPtr.Size + sizeof(uint) || required > 4096) throw new UnauthorizedAccessException("GUI integrity label is unavailable.");
            IntPtr buffer = Marshal.AllocHGlobal(required);
            uint integrity;
            try
            {
                if (!GetTokenInformationBuffer(token, 25, buffer, required, out int returned) || returned > required)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot verify GUI integrity.");
                IntPtr sid = Marshal.ReadIntPtr(buffer);
                long offset = sid.ToInt64() - buffer.ToInt64();
                if (offset < IntPtr.Size + sizeof(uint) || offset > returned - 8 || !IsValidSid(sid))
                    throw new UnauthorizedAccessException("GUI integrity SID is invalid.");
                uint length = GetLengthSid(sid);
                if (length < 12 || length > returned - offset) throw new UnauthorizedAccessException("GUI integrity SID escaped its native buffer.");
                byte count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                if (count == 0) throw new UnauthorizedAccessException("GUI integrity SID has no label.");
                integrity = unchecked((uint)Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1))));
            }
            finally { Marshal.FreeHGlobal(buffer); }
            using WindowsIdentity identity = new(token);
            bool administrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            return new GuiPrivilege(elevation == 1, administrator, IsTokenRestricted(token), integrity);
        }
        finally { CloseHandle(token); }
    }

    internal static void Require(Process process)
    {
        if (!Read(process).Allowed) throw new UnauthorizedAccessException("Core GUI operations require an elevated, unrestricted High administrator token.");
    }

    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(IntPtr token, int information, out int value, int length, out int returned);
    [DllImport("advapi32.dll", EntryPoint = "GetTokenInformation", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformationBuffer(IntPtr token, int information, IntPtr value, int length, out int returned);
    [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsTokenRestricted(IntPtr token);
    [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsValidSid(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}