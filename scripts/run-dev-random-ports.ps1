function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

$backendPort = Get-FreePort
$frontendPort = Get-FreePort
while ($frontendPort -eq $backendPort) {
  $frontendPort = Get-FreePort
}

$env:PORT = "$backendPort"
$env:VITE_API_URL = "http://localhost:$backendPort"
$env:VITE_WS_URL = "ws://localhost:$backendPort"

Write-Host "Using backend port: $backendPort"
Write-Host "Using frontend port: $frontendPort"
Write-Host "Backend URL: http://localhost:$backendPort"
Write-Host "Frontend URL: http://localhost:$frontendPort"

npx --yes concurrently --kill-others-on-fail "npm start --prefix backend" "npm run dev --prefix frontend -- --port $frontendPort --strictPort"
