# 等整机 CPU 安静：连续 $Need 个 1 秒采样都低于 $Max(%) 才返回；超过 $TimeoutSec 秒就带着最近的平均值返回
param([double]$Max = 15, [int]$Need = 8, [int]$TimeoutSec = 900)
$sw = [Diagnostics.Stopwatch]::StartNew(); $ok = 0; $last = @()
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
  $v = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples[0].CookedValue
  $last = @(@($last) + $v | Select-Object -Last $Need)
  if ($v -lt $Max) { $ok++ } else { $ok = 0 }
  if ($ok -ge $Need) { "idle mean=$([math]::Round(($last | Measure-Object -Average).Average,1)) waited=$([int]$sw.Elapsed.TotalSeconds)s"; exit 0 }
}
"timeout mean=$([math]::Round(($last | Measure-Object -Average).Average,1)) waited=$([int]$sw.Elapsed.TotalSeconds)s"; exit 1
