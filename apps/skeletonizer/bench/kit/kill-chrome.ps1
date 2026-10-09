# 关掉指定调试端口的测试 Chrome（不影响其他 Chrome）
param([int]$Port)
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*remote-debugging-port=$Port*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
