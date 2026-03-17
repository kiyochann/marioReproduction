
Add-Type -AssemblyName System.Drawing
$dir = "C:\Users\G2546\Desktop\study_file\base_program\後期\課題マリオ\dokan\dokan(under)"
Get-ChildItem -Path $dir -Filter "*.png" | ForEach-Object {
    $img = [System.Drawing.Image]::FromFile($_.FullName)
    Write-Output "$($_.Name): $($img.Width)x$($img.Height)"
    $img.Dispose()
}
