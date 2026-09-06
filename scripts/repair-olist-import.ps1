$ErrorActionPreference = "Stop"
$projectId = "prj_DDipv3c8GY2pHqDhHdMr0dHtE5ll"
$teamId = "team_JLpKHt2fkAaUtXsTjTJq3Gil"
$cronEnvId = "TEpY8vfR0ivBNnwr"
$endpoint = "https://fitgestor-erp.vercel.app/api/public/hooks/olist-sync"
$auth = Get-Content -Raw -LiteralPath "C:\Users\Patri\AppData\Roaming\com.vercel.cli\Data\auth.json" | ConvertFrom-Json
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
$body = @{ value=$secret; type="sensitive"; target=@("production","preview","development") } | ConvertTo-Json -Compress
$null = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/$projectId/env/$cronEnvId`?teamId=$teamId" -Method Patch -Headers @{Authorization="Bearer $($auth.token)";"content-type"="application/json"} -Body $body
$env:PATH="C:\Users\Patri\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
$env:NODE_USE_SYSTEM_CA="1"
& "C:\Users\Patri\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" dlx --allow-build=esbuild vercel@48.11.0 --prod --yes
if ($LASTEXITCODE -ne 0) { throw "Falha no deploy" }
$ids=@("347674930","343623435","343114388","343624304","341741301","341740914","341741606","341740610","341741734","343121499","342637591","346451426","341742111","341742032","341741944","342783962")
$results=@()
for($i=0;$i -lt $ids.Count;$i+=3){
  $last=[Math]::Min($i+2,$ids.Count-1)
  $payload=@{action="import_products";externalIds=@($ids[$i..$last])}|ConvertTo-Json -Compress
  $response=Invoke-RestMethod -Uri $endpoint -Method Post -Headers @{"x-cron-secret"=$secret;"content-type"="application/json"} -Body $payload -TimeoutSec 300
  $results+=@($response.results)
  Write-Output ("REPAIR_PROGRESS processed={0}/{1}" -f ($last+1),$ids.Count)
}
Write-Output ("REPAIR_COMPLETE "+($results|ConvertTo-Json -Depth 12 -Compress))
