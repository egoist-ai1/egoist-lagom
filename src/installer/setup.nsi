Unicode true
!define MUI_ICON "${PAYLOAD}\resources\brand\icon.ico"
!define MUI_UNICON "${PAYLOAD}\resources\brand\icon.ico"
Icon "${PAYLOAD}\resources\brand\icon.ico"
UninstallIcon "${PAYLOAD}\resources\brand\icon.ico"
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
Name "Egoist Lagom ${PRODUCT_VERSION}"
OutFile "${OUTPUT}"
InstallDir "$PROGRAMFILES64\EgoistShield"
RequestExecutionLevel admin
CRCCheck force
SetCompressor /SOLID lzma
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "Egoist Lagom"
VIAddVersionKey "FileDescription" "Egoist Lagom Setup"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}.0"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}.0"
VIAddVersionKey "LegalCopyright" "EGOIST"

AutoCloseWindow true
ShowInstDetails nevershow

!define MUI_CUSTOMFUNCTION_GUIINIT HideNsisWindow
!define MUI_PAGE_CUSTOMFUNCTION_PRE HideNsisWindow
!define MUI_PAGE_CUSTOMFUNCTION_SHOW HideNsisWindow

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Var PhaseResult
Var RollbackNeeded
Var WaitTicks
Var FailureMessage
Var InstallerMutex

!macro AcquireInstallerMutex
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Global\EgoistShield.Installation") p .r0 ?e'
  Pop $1
  StrCpy $InstallerMutex $0
  ${If} $InstallerMutex == 0
  ${OrIf} $1 == 183
    SetErrorLevel 48
    ${IfNot} ${Silent}
      MessageBox MB_OK "Установка или удаление Egoist Lagom уже выполняется. Дождитесь завершения."
    ${EndIf}
    Abort
  ${EndIf}
!macroend

Function HideNsisWindow
  ${IfNot} ${Silent}
    ShowWindow $HWNDPARENT 0
    System::Call "user32::SetWindowPos(i $HWNDPARENT, i 0, i -32000, i -32000, i 0, i 0, i 0x0080)"
  ${EndIf}
FunctionEnd

!macro RunPhase PHASE
  ${DisableX64FSRedirection}
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\owned-cleanup.ps1" -Phase ${PHASE} -InstallRoot "$INSTDIR"'
  Pop $PhaseResult
  ${EnableX64FSRedirection}
!macroend

Function .onInit
  !insertmacro AcquireInstallerMutex
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Эта сборка требует Windows x64."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Требуется Windows 10 или Windows 11."
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext all
  StrCpy $INSTDIR "$PROGRAMFILES64\EgoistShield"
  InitPluginsDir
  File /oname=$PLUGINSDIR\owned-cleanup.ps1 "${PAYLOAD}\resources\installer\owned-cleanup.ps1"
  File /oname=$PLUGINSDIR\ModernInstaller.exe "${PAYLOAD}\resources\installer\ModernInstaller.exe"
  File /oname=$PLUGINSDIR\Unbounded.ttf "${PAYLOAD}\resources\installer\Unbounded.ttf"

  ${IfNot} ${Silent}
    ; Launch Modern Next.js-style installer UI
    Exec '"$PLUGINSDIR\ModernInstaller.exe" "$PLUGINSDIR"'

    ; Wait for user decision
    StrCpy $WaitTicks 0
    WaitLoop:
      Sleep 100
      IntOp $WaitTicks $WaitTicks + 1
      IfFileExists "$PLUGINSDIR\cancel.flag" UserCancelled 0
      IfFileExists "$PLUGINSDIR\start_install.flag" UserStarted 0
      ${If} $WaitTicks >= 3000
        MessageBox MB_ICONSTOP "Не удалось запустить окно установки. Повторите запуск установщика."
        Abort
      ${EndIf}
      Goto WaitLoop

    UserCancelled:
      Abort

    UserStarted:
      ; The Core service and uninstaller use one canonical location. Keeping it
      ; fixed avoids path-dependent service and upgrade failures.
      StrCpy $INSTDIR "$PROGRAMFILES64\EgoistShield"
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro AcquireInstallerMutex
FunctionEnd

Function RollbackFailedInstall
  ${If} $RollbackNeeded == "1"
    !insertmacro RunPhase RollbackUpgrade
    StrCpy $RollbackNeeded "0"
    ${If} $PhaseResult != "0"
      StrCpy $FailureMessage "$FailureMessage Восстановление не завершено; сохранённые файлы оставлены для повторной попытки."
    ${EndIf}
  ${EndIf}
  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "0|ERROR: $FailureMessage Журнал: $APPDATA\EgoistShield\Installer\upgrade-journal.json"
    FileClose $0
    StrCpy $WaitTicks 0
    FailureWait:
      IfFileExists "$PLUGINSDIR\cancel.flag" FailureDone 0
      Sleep 100
      IntOp $WaitTicks $WaitTicks + 1
      ${If} $WaitTicks < 600
        Goto FailureWait
      ${EndIf}
    FailureDone:
  ${EndIf}
FunctionEnd

Function .onInstFailed
  ${If} $RollbackNeeded == "1"
    StrCpy $FailureMessage "Установка прервана."
    Call RollbackFailedInstall
  ${EndIf}
FunctionEnd

Section "Egoist Lagom"
  StrCpy $RollbackNeeded "1"

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "10|Подготовка сетевых компонентов..."
    FileClose $0
  ${EndIf}

  !insertmacro RunPhase PreInstall
  ${If} $PhaseResult != "0"
    StrCpy $FailureMessage "Ошибка подготовки установки (код $PhaseResult)."
    Call RollbackFailedInstall
    SetErrorLevel 41
    Quit
  ${EndIf}

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "30|Распаковка файлов программы..."
    FileClose $0
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"
  ${If} ${Errors}
    StrCpy $FailureMessage "Ошибка копирования файлов."
    Call RollbackFailedInstall
    SetErrorLevel 42
    Quit
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall Egoist Shield.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "DisplayName" "Egoist Lagom"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "Publisher" "EGOIST"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "DisplayIcon" "$INSTDIR\EgoistShield.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "UninstallString" '"$INSTDIR\Uninstall Egoist Shield.exe"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield" "NoRepair" 1

  ; Grant highest administrative privileges without restrictions by default (RUNASADMIN)
  WriteRegStr HKLM "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe" "~ RUNASADMIN"
  WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe" "~ RUNASADMIN"
  SetRegView 32
  WriteRegStr HKLM "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe" "~ RUNASADMIN"
  WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe" "~ RUNASADMIN"
  SetRegView 64

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "75|Регистрация системной службы безопасности..."
    FileClose $0
  ${EndIf}

  !insertmacro RunPhase InstallCoreService
  ${If} $PhaseResult != "0"
    StrCpy $FailureMessage "Ошибка регистрации службы (код $PhaseResult)."
    Call RollbackFailedInstall
    SetErrorLevel 43
    Quit
  ${EndIf}

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "88|Настройка параметров и проверка..."
    FileClose $0
  ${EndIf}

  !insertmacro RunPhase PostInstall
  ${If} $PhaseResult != "0"
    StrCpy $FailureMessage "Новая версия не прошла проверку установки (код $PhaseResult)."
    Call RollbackFailedInstall
    SetErrorLevel 44
    Quit
  ${EndIf}

  ; PostInstall validates Core before committing and deleting the old payload.
  StrCpy $RollbackNeeded "0"

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "95|Создание ярлыков и обновление кэша иконок..."
    FileClose $0
  ${EndIf}

  CreateShortcut "$SMPROGRAMS\Egoist Lagom.lnk" "$INSTDIR\EgoistShield.exe" "" "$INSTDIR\resources\brand\icon.ico" 0

  ; Check desktop shortcut flag
  IfFileExists "$PLUGINSDIR\desktop_shortcut.txt" 0 DoneDesktopShortcut
  FileOpen $0 "$PLUGINSDIR\desktop_shortcut.txt" r
  FileRead $0 $1
  FileClose $0
  ${If} $1 == "1"
    CreateShortcut "$DESKTOP\Egoist Lagom.lnk" "$INSTDIR\EgoistShield.exe" "" "$INSTDIR\resources\brand\icon.ico" 0
  ${EndIf}
DoneDesktopShortcut:

  ; Set RunAsAdmin flag (0x20 at byte 21) on shortcuts so they always launch elevated
  ${DisableX64FSRedirection}
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$scs = @(\"$SMPROGRAMS\Egoist Lagom.lnk\", \"$DESKTOP\Egoist Lagom.lnk\"); foreach ($$p in $$scs) { if (Test-Path -LiteralPath $$p) { $$b = [IO.File]::ReadAllBytes($$p); if ($$b.Length -gt 21) { $$b[21] = $$b[21] -bor 0x20; [IO.File]::WriteAllBytes($$p, $$b) } } }"'
  Pop $0
  ${EnableX64FSRedirection}

  ; Purge Windows shell icon cache so Hermes icon renders everywhere immediately!
  nsExec::Exec '"ie4uinit.exe" -show'

  ${IfNot} ${Silent}
    ; Signal DONE to ModernInstaller
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "100|DONE"
    FileClose $0

    ; Wait for ModernInstaller to finish/close
    StrCpy $2 0
    WaitFinish:
      Sleep 100
      IntOp $2 $2 + 1
      ${If} $2 > 600
        Goto DoneFinish
      ${EndIf}
      IfFileExists "$PLUGINSDIR\finished.flag" DoneFinish 0
      IfFileExists "$PLUGINSDIR\cancel.flag" DoneFinish 0
      Goto WaitFinish
    DoneFinish:
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  ${If} $INSTDIR != "$PROGRAMFILES64\EgoistShield"
    Abort "Неожиданный путь установки. Удаление остановлено."
  ${EndIf}
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\resources\installer\owned-cleanup.ps1" "$PLUGINSDIR\owned-cleanup.ps1"
  !insertmacro RunPhase Uninstall
  ${If} $PhaseResult != "0"
    SetErrorLevel 46
    Abort "Сначала необходимо восстановить сетевые настройки. Файлы сохранены."
  ${EndIf}
  Delete "$SMPROGRAMS\Egoist Lagom.lnk"
  Delete "$DESKTOP\Egoist Lagom.lnk"
  Delete "$SMPROGRAMS\Egoist Shield.lnk"
  Delete "$DESKTOP\Egoist Shield.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield"
  DeleteRegValue HKLM "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe"
  SetRegView 32
  DeleteRegValue HKLM "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\EgoistShield.exe"
  SetRegView 64
  RMDir /r "$INSTDIR"
  ${If} ${FileExists} "$INSTDIR\EgoistShield.exe"
    SetErrorLevel 47
    Abort "Файлы приложения ещё заняты. Закройте приложение и повторите удаление."
  ${EndIf}
SectionEnd
