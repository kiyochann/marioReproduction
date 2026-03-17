Add-Type -AssemblyName System.Drawing
$files = @(
    "assets\mario\mario_1(neutral).png",
    "assets\mario\mario8_goal.png"
)
foreach ($f in $files) {
    if (Test-Path $f) {
        $img = [System.Drawing.Image]::FromFile((Resolve-Path $f).Path)
        Write-Output "$f size: $($img.Width)x$($img.Height)" | Out-File -Append .\mario_sizes.txt -Encoding UTF8
        $img.Dispose()
    }
}
