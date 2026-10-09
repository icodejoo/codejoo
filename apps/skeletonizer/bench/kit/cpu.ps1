# 采样 3 秒整机 CPU 占用，逗号分隔输出
$s = Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 3
($s.CounterSamples | ForEach-Object { [math]::Round($_.CookedValue, 1) }) -join ','
