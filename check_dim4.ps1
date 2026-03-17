Add-Type -AssemblyName System.Drawing
foreach ($f in Get-ChildItem "assets\pipe\dokan_under*.png") {
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    Write-Host "$($f.Name) : $($img.Width)x$($img.Height)"
    $img.Dispose()
}
