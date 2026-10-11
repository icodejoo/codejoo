# 后台 CPU 采样：每秒一次写到 $Out（时间戳,百分比），直到被结束
param([string]$Out)
while ($true) { $v = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples[0].CookedValue; "$((Get-Date).ToString('HH:mm:ss')),$([math]::Round($v,1))" | Add-Content $Out }
