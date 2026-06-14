param([string]$name = "clip1")
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$i = [System.Windows.Forms.Clipboard]::GetImage()
if ($i) {
  $dir = "D:\workspaces\codejoo\apps\counter\ref"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $path = Join-Path $dir ($name + ".png")
  $i.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output ("SAVED " + $path + " " + $i.Width + "x" + $i.Height)
} else {
  Write-Output "NOIMG"
}
