$headers = @{"x-api-key"="aries-api-2026"}
$base = "http://localhost:3333"
$endpoints = @(
  "/api/status", "/api/health", "/api/config",
  "/api/chat/history", "/api/agents", "/api/agents/types",
  "/api/swarm/status", "/api/swarm/agents",
  "/api/memory", "/api/memory/search",
  "/api/tools", "/api/tools/list",
  "/api/code/run", "/api/code/status",
  "/api/dreams", "/api/dreams/pending", "/api/dreams/config",
  "/api/evolution/status", "/api/evolution/population",
  "/api/dna/status",
  "/api/hive/status", "/api/hive/thoughts",
  "/api/perception/status",
  "/api/instincts/status",
  "/api/emotion/status", "/api/emotion/state",
  "/api/body/status", "/api/body/skeleton", "/api/body/circulatory", "/api/body/immune", "/api/body/reflexes",
  "/api/arena", "/api/arena/status",
  "/api/breeding/population",
  "/api/reputation", "/api/reputation/status",
  "/api/self-improve/status",
  "/api/templates", "/api/templates/list",
  "/api/training/status",
  "/api/cognitive/status",
  "/api/mind/status", "/api/mind/inner-monologue",
  "/api/network/status", "/api/network/scan",
  "/api/proxy/status",
  "/api/projects", "/api/projects/list",
  "/api/canvas/status",
  "/api/cron/jobs",
  "/api/sessions", "/api/sessions/list",
  "/api/webhooks", "/api/webhooks/list",
  "/api/apps", "/api/apps/list",
  "/api/store", "/api/store/list",
  "/api/desktop/status",
  "/api/voice/status",
  "/api/usage", "/api/usage/stats",
  "/api/users", "/api/users/list",
  "/api/journal", "/api/journal/entries",
  "/api/time-travel/snapshots",
  "/api/logs", "/api/logs/list",
  "/api/plugins", "/api/plugins/list",
  "/api/scheduler/status",
  "/api/sandbox/status",
  "/api/files", "/api/files/list",
  "/api/notifications", "/api/notifications/list",
  "/api/settings", "/api/preferences",
  "/api/dashboard", "/api/dashboard/stats",
  "/api/metrics", "/api/analytics",
  "/api/search", "/api/index",
  "/api/tasks", "/api/tasks/list",
  "/api/workflows", "/api/workflows/list",
  "/api/integrations", "/api/integrations/list",
  "/api/audit", "/api/audit/log"
)

foreach ($ep in $endpoints) {
  try {
    $r = Invoke-WebRequest -Uri ($base + $ep) -Headers $headers -UseBasicParsing -TimeoutSec 5
    Write-Output ("{0} -> {1}" -f $ep, $r.StatusCode)
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if (-not $code) { $code = "CONN_ERROR" }
    Write-Output ("{0} -> {1}" -f $ep, $code)
  }
}
