# Exact production Add-ReceiptEvent AST excerpt before writer serialization.
function Add-ReceiptEvent {
  param([string]$Stage, [string]$Status, [string]$Message = "", [hashtable]$Data = @{})
  $receiptPath = Join-Path $StageDirectory "receipt.json"
  $receipt = if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
    Get-Content -LiteralPath $receiptPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  } else {
    [pscustomobject]@{
      schemaVersion = 1
      owner = "EgoistShield"
      runId = Split-Path -Leaf $StageDirectory
      createdAt = [DateTime]::UtcNow.ToString("o")
      status = "created"
      events = @()
    }
  }
  $receiptEvent = [ordered]@{
    at = [DateTime]::UtcNow.ToString("o")
    stage = $Stage
    status = $Status
    message = $Message
    data = $Data
  }
  $receipt.events = @($receipt.events) + [pscustomobject]$receiptEvent
  $receipt.status = $Status
  $receipt | Add-Member -NotePropertyName updatedAt -NotePropertyValue $receiptEvent.at -Force
  Write-JsonAtomic -Path $receiptPath -Value $receipt
  Write-BrandedInstallerStatus -Stage $Stage -Status $Status -Message $Message -Data $Data
}
