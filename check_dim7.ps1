Add-Type -AssemblyName System.Drawing
$files = @(
    "assets\smario\smario_1(neutral).png",
    "assets\smario\smario_7(duck).png",
    "assets\firemario\fsMario1(neutral).png",
    "assets\firemario\fsMario7(down).png"
)
foreach ($f in $files) {
    if (Test-Path $f) {
        $img = [System.Drawing.Image]::FromFile((Resolve-Path $f).Path)
        Write-Output "$f size: $($img.Width)x$($img.Height)" | Out-File -Append .\smario_sizes.txt -Encoding UTF8
        $img.Dispose()
    }
}
