param([Parameter(Mandatory=$true)][string]$HarnessPath)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
foreach($path in @($HarnessPath)){if(-not [IO.Path]::IsPathRooted($path)){throw 'Explicit absolute harness paths required.'}}
$sourceTokens=$null;$sourceErrors=$null
$sourceAst=[Management.Automation.Language.Parser]::ParseFile($HarnessPath,[ref]$sourceTokens,[ref]$sourceErrors)
$draftAst=$sourceAst
$script:Cases=[Collections.Generic.List[object]]::new()
function Get-FixtureFileSha256 {param([string]$Path)
  $digest=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($digest.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-','').ToLowerInvariant()}
  finally{$digest.Dispose()}
}
function Assert-Case {param([string]$Name,[bool]$Value) if(-not $Value){throw ('Case failed: '+$Name)};$script:Cases.Add([ordered]@{name=$Name;passed=$true})}
function Get-AstFunction {param($Ast,[string]$Name)
  $found=@($Ast.FindAll({param($item)$item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -ceq $Name},$true))
  if($found.Count -ne 1){throw ('Exact actual AST function required: '+$Name)};return $found[0]
}
function Set-AstFunction {param($Ast,[string]$Name)
  $node=Get-AstFunction $Ast $Name;$prefix=''
  if($node.Parameters){$prefix='param('+(@($node.Parameters|ForEach-Object{$_.Extent.Text}) -join ',')+')'+[Environment]::NewLine}
  $body=$node.Body.Extent.Text.Substring(1,$node.Body.Extent.Text.Length-2)
  Set-Item -Path ('Function:script:'+ $Name) -Value ([scriptblock]::Create($prefix+$body))
}
function Get-FreshErrorGuard {param($Ast)
  $found=@($Ast.FindAll({param($node)$node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -clike '*TG occupied-port attempt began with an earlier GUI failure.*'},$true))
  if($found.Count -ne 1){throw 'Exact existing occupied-port failure guard required.'};return $found[0].Extent.Text
}
Assert-Case 'Actual source whole harness parses with zero errors' ($sourceErrors.Count -eq 0)
$draftCaller=Get-AstFunction $draftAst 'Invoke-NativeElevatedGui'
$knownCalls=@($draftCaller.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Wait-NativeTelegramStoppedGuiCompletion'},$true))
if($knownCalls.Count -ne 1){throw 'One current GUI stop-completion call is required.'}
$redCaller=$draftCaller.Extent.Text.Replace($knownCalls[0].Extent.Text,'')
Assert-Case 'RED one known caller mutation removes the stop ACK admission in memory only' ($redCaller.IndexOf('Wait-NativeTelegramStoppedGuiCompletion',[StringComparison]::Ordinal) -eq -1)
$barrierPosition=$draftCaller.Extent.Text.IndexOf('Wait-NativeTelegramStoppedGuiCompletion',[StringComparison]::Ordinal)
$actorPosition=$draftCaller.Extent.Text.IndexOf('Invoke-NativeTelegramOccupiedPort',[StringComparison]::Ordinal)
Assert-Case 'GREEN actual caller places GUI stop completion before actor and records its receipt' ($barrierPosition -ge 0 -and $barrierPosition -lt $actorPosition -and $draftCaller.Extent.Text.Contains('$script:Receipt.elevatedGui.stopOperationCompletion=$stopCompletion;Save-NativeReceipt'))
$selector=(Get-AstFunction $sourceAst 'Get-NativeTelegramGuiVisibleError').Extent.Text
Assert-Case 'Current error selector requires exact visible Text title' ($selector.Contains('$title=''Действие не выполнено''') -and $selector.Contains('$element.Current.Name -ceq $title') -and $selector.Contains('-not $element.Current.IsOffscreen') -and $selector.Contains('[Windows.Automation.ControlType]::Text'))
$guard=Get-FreshErrorGuard $sourceAst
Assert-Case 'Current pre-ON guard rejects the exact visible failure before invocation' ($guard.Contains('if(Get-NativeTelegramGuiVisibleError -Root $Root)') -and $guard.Contains("throw 'TG occupied-port attempt began with an earlier GUI failure.'"))
Set-AstFunction $sourceAst 'Wait-NativeCondition'
Set-AstFunction $draftAst 'Wait-NativeTelegramStoppedGuiCompletion'
$script:Frames=@();$script:FrameIndex=0;$script:FindCalls=0;$script:ErrorCalls=0;$script:MockOnRequests=0
function Start-Sleep {param([int]$Milliseconds)
  if($Milliseconds -ne 250){throw 'Unexpected poll delay.'};$script:FrameIndex++
  if($script:FrameIndex -ge $script:Frames.Count){throw 'Inert frames exhausted before the actual completion guard accepted ACK.'}
}
# These are OS/UIA leaves only. The actual waiting/identity/error/button guards above are unchanged functions.
function Get-NativeTelegramGuiVisibleError {param($Root)
  if(-not $Root -or $Root.Current.ProcessId -ne 771){throw 'Mock UI root differs from the fictional exact GUI.'};$script:ErrorCalls++;if($script:Frames[$script:FrameIndex].error){return [ordered]@{title='Действие не выполнено'}};return $null
}
$find={param([string]$Name)
  $script:FindCalls++;if($Name -cne 'Запустить'){throw 'Unexpected genuine control name.'}
  $frame=$script:Frames[$script:FrameIndex]
  if($frame.name){return [pscustomobject]@{Current=[pscustomobject]@{Name=$frame.name;IsEnabled=$frame.enabled;IsOffscreen=$frame.offscreen}}}
}
function New-Frame {param([string]$Name='Запустить',[bool]$Enabled=$true,[bool]$Offscreen=$false,[bool]$HasFailure=$false)
  return [pscustomobject]@{name=$Name;enabled=$Enabled;offscreen=$Offscreen;error=$HasFailure}
}
function New-FakeGui {
  $process=[pscustomobject]@{Id=771;HasExited=$false};$process|Add-Member ScriptMethod Refresh {}
  return [pscustomobject]@{process=$process;root=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=771}}}
}
function Set-FrameSequence {param([object[]]$Frames) $script:Frames=$Frames;$script:FrameIndex=0;$script:FindCalls=0;$script:ErrorCalls=0}
function Test-Refusal {param([scriptblock]$Call,[string]$Expected)
  try{& $Call |Out-Null}catch{if($_.Exception.Message -notlike $Expected){throw};return $true};return $false
}
$gui=New-FakeGui
Set-FrameSequence @((New-Frame -Name 'Останавливается…' -Enabled $false),(New-Frame))
$ack=Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'
Assert-Case 'SCM stopped with pending disabled GUI is not ACK; accepts only subsequent genuine Start' ($script:FrameIndex -eq 1 -and $script:FindCalls -eq 2 -and $ack.name -ceq 'Запустить' -and $ack.processId -eq 771 -and $script:MockOnRequests -eq 0)
Set-FrameSequence @((New-Frame -Enabled $false),(New-Frame))
$ack=Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'
Assert-Case 'Disabled Start cannot acknowledge stop' ($script:FrameIndex -eq 1 -and $ack.enabled)
Set-FrameSequence @((New-Frame -Offscreen $true),(New-Frame))
$ack=Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'
Assert-Case 'Offscreen Start cannot acknowledge stop' ($script:FrameIndex -eq 1 -and $ack.enabled)
Set-FrameSequence @((New-Frame -Name 'Остановить'),(New-Frame))
$ack=Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'
Assert-Case 'Wrong control name cannot acknowledge stop' ($script:FrameIndex -eq 1 -and $ack.name -ceq 'Запустить')
Set-FrameSequence @((New-Frame -HasFailure $true))
$refused=Test-Refusal {Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'} '*Actual GUI reports failed Telegram stop operation*'
Assert-Case 'Genuine earlier action error is rejected before selecting Start; no dismiss/reset' ($refused -and $script:FindCalls -eq 0 -and $script:MockOnRequests -eq 0)
Set-FrameSequence @((New-Frame -Enabled $false),(New-Frame -HasFailure $true))
$refused=Test-Refusal {Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'} '*Actual GUI reports failed Telegram stop operation*'
Assert-Case 'Failure arriving while awaiting stop ACK is rejected' ($refused -and $script:FrameIndex -eq 1 -and $script:FindCalls -eq 1)
Set-FrameSequence @((New-Frame));$gui.process.HasExited=$true
$refused=Test-Refusal {Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'} '*GUI exited before Telegram stop*'
Assert-Case 'Exited exact GUI is rejected before reading UI' ($refused -and $script:ErrorCalls -eq 0 -and $script:FindCalls -eq 0)
$gui=New-FakeGui;Set-FrameSequence @((New-Frame));$gui.root.Current.ProcessId=772
$refused=Test-Refusal {Wait-NativeTelegramStoppedGuiCompletion -FindButton $find -Process $gui.process -Root $gui.root -Label 'inert'} '*root changed GUI identity*'
Assert-Case 'Changed root PID rejected before reading UI' ($refused -and $script:ErrorCalls -eq 0 -and $script:FindCalls -eq 0)
$gui=New-FakeGui;Set-FrameSequence @((New-Frame -HasFailure $true));$Root=$gui.root
$refused=Test-Refusal {& ([scriptblock]::Create($guard))} '*TG occupied-port attempt began with an earlier GUI failure*'
Assert-Case 'Original pre-ON guard still rejects a failure after stop ACK and before start invoke' ($refused -and $script:MockOnRequests -eq 0)
$inputs=@(foreach($path in @($HarnessPath)){[ordered]@{path=$path;bytes=([IO.FileInfo]::new($path)).Length;sha256=(Get-FixtureFileSha256 -Path $path)}})
[ordered]@{schemaVersion=1;kind='source-bound-readonly-telegram-stop-completion-ci-guards';edition=$PSVersionTable.PSEdition;powerShellVersion=$PSVersionTable.PSVersion.ToString();powerShellMajor=$PSVersionTable.PSVersion.Major;parserErrors=0;actualAstFunctions=2;actualOriginalIfGuards=1;redCallerInMemoryOnly=$true;inputs=$inputs;passed=$script:Cases.Count;cases=@($script:Cases.ToArray());scope=[ordered]@{mockUiLeaves=$true;mockOnRequests=$script:MockOnRequests;liveUiAutomationCalls=0;nativeServiceActions=0;privateStateReads=0;nativeProcessQueries=0;actualNetworkActions=0;sourceWrites=0};limitation='Only public PowerShell AST and fictional GUI leaves. No native GUI stop, actor bind, SCM, Core, UAC or installed product readback was performed.'}|ConvertTo-Json -Depth 8