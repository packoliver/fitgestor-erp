$ErrorActionPreference = "Stop"

$projectId = "prj_DDipv3c8GY2pHqDhHdMr0dHtE5ll"
$teamId = "team_JLpKHt2fkAaUtXsTjTJq3Gil"
$cronEnvId = "TEpY8vfR0ivBNnwr"
$endpoint = "https://fitgestor-erp.vercel.app/api/public/hooks/olist-sync"
$authPath = "C:\Users\Patri\AppData\Roaming\xdg.data\com.vercel.cli\auth.json"

function Invoke-ImportRequest {
  param([hashtable]$Payload, [int]$MaxAttempts = 4)
  $body = $Payload | ConvertTo-Json -Depth 8 -Compress
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      return Invoke-RestMethod -Uri $endpoint -Method Post -Headers @{
        "x-cron-secret" = $script:cronSecret
        "content-type" = "application/json"
      } -Body $body -TimeoutSec 300
    } catch {
      if ($attempt -eq $MaxAttempts) { throw }
      Write-Output ("RETRY attempt={0} reason={1}" -f $attempt, $_.Exception.Message)
      Start-Sleep -Seconds ([Math]::Min(20, $attempt * 4))
    }
  }
}

$auth = Get-Content -Raw -LiteralPath $authPath | ConvertFrom-Json
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$script:cronSecret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

$patchBody = @{
  value = $script:cronSecret
  type = "sensitive"
  target = @("production", "preview", "development")
} | ConvertTo-Json -Compress
$null = Invoke-RestMethod `
  -Uri "https://api.vercel.com/v9/projects/$projectId/env/$cronEnvId`?teamId=$teamId" `
  -Method Patch `
  -Headers @{ Authorization = "Bearer $($auth.token)"; "content-type" = "application/json" } `
  -Body $patchBody
Write-Output "CRON_SECRET_UPDATED"

$env:NODE_USE_SYSTEM_CA = "1"
& npx vercel --prod --yes
if ($LASTEXITCODE -ne 0) { throw "Falha ao publicar na Vercel" }
Write-Output "DEPLOYMENT_READY"

$pilot = Invoke-ImportRequest -Payload @{
  action = "import_products"
  externalIds = @("339809813")
}
Write-Output ("PILOT_RESULT " + ($pilot | ConvertTo-Json -Depth 12 -Compress))
Write-Output "PILOT_PAUSED"
$continue = Read-Host
if ($continue -ne "GO") { throw "Importação integral não iniciada" }

$firstPage = Invoke-ImportRequest -Payload @{ action = "list_page"; page = 1 }
$totalPages = [int]$firstPage.catalogPage.totalPages
$processed = 0
$failures = New-Object System.Collections.Generic.List[object]

for ($page = 1; $page -le $totalPages; $page++) {
  $pageResult = if ($page -eq 1) { $firstPage } else {
    Invoke-ImportRequest -Payload @{ action = "list_page"; page = $page }
  }
  $products = @($pageResult.catalogPage.products)
  for ($index = 0; $index -lt $products.Count; $index += 3) {
    $last = [Math]::Min($index + 2, $products.Count - 1)
    $ids = @($products[$index..$last] | ForEach-Object { [string]$_.externalId })
    $batch = Invoke-ImportRequest -Payload @{ action = "import_products"; externalIds = $ids }
    foreach ($result in @($batch.results)) {
      $processed++
      if (-not $result.ok -or @($result.counters.errors).Count -gt 0) {
        $failures.Add($result)
      }
    }
    Write-Output ("IMPORT_PROGRESS page={0}/{1} processed={2} failures={3}" -f $page, $totalPages, $processed, $failures.Count)
  }
}

Write-Output ("IMPORT_COMPLETE " + (@{
  pages = $totalPages
  processed = $processed
  failures = $failures
} | ConvertTo-Json -Depth 16 -Compress))
