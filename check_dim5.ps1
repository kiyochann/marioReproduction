Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path "assets\mario\mario8_goal.png").Path)
Write-Output "mario8_goal.png size: $($img.Width)x$($img.Height)" | Out-File .\mario_goal_dim.txt -Encoding UTF8
$img.Dispose()
