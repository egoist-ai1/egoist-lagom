$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ShieldDialog {
  public delegate bool Callback(IntPtr hwnd,IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,Callback callback,IntPtr arg);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int size);
  public static string Read(IntPtr parent){var lines=new List<string>();EnumChildWindows(parent,(hwnd,arg)=>{var text=new StringBuilder(16384);GetWindowText(hwnd,text,text.Capacity);if(text.Length>0)lines.Add(text.ToString());return true;},IntPtr.Zero);return string.Join("\n",lines);}
}
'@
$p=Start-Process 'C:\Program Files\EgoistShield\EgoistShield.exe' -ArgumentList '--disable-gpu','--enable-logging' -PassThru -RedirectStandardError 'C:\ShieldLab\early-startup.txt'
try{
  $deadline=[DateTime]::UtcNow.AddSeconds(90)
  while([DateTime]::UtcNow -lt $deadline){$p.Refresh();if($p.HasExited -or $p.MainWindowHandle -ne 0){break};Start-Sleep -Seconds 2}
  Write-Output ('TITLE='+$p.MainWindowTitle)
  if($p.MainWindowHandle -ne 0){Write-Output ([ShieldDialog]::Read($p.MainWindowHandle))}
  $failed=$p.MainWindowTitle -eq 'Error'
}finally{if(-not $p.HasExited){$p.Kill();$p.WaitForExit()}}
if(Test-Path 'C:\ShieldLab\early-startup.txt'){Write-Output ([IO.File]::ReadAllText('C:\ShieldLab\early-startup.txt'))}
if($failed){throw 'Electron failed before application bootstrap'}
