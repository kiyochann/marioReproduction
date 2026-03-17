Add-Type -AssemblyName System.Drawing
$files = @(
    "assets\mario\mario8_goal.png",
    "assets\pipe\dokan_under_left_up.png",
    "assets\pipe\dokan_under_left_down.png",
    "assets\pipe\dokan_under_right_up.png",
    "assets\pipe\dokan_under_right_down.png",
    "assets\pipe\dokan.png"
)
foreach ($f in $files) {
    if (Test-Path $f) {
        $img = [System.Drawing.Image]::FromFile((Resolve-Path $f).Path)
        Write-Host "$f : $($img.Width)x$($img.Height)"
        $img.Dispose()
    }
}
