Add-Type -AssemblyName System.Drawing

function Print-Ascii($path, $maxLines) {
    if (-Not (Test-Path $path)) { Write-Output "Not found: $path"; return }
    $bmp = [System.Drawing.Bitmap]::FromFile($path)
    Write-Output "Image Size: $($bmp.Width) x $($bmp.Height)"
    
    $limit = $bmp.Height
    if ($maxLines -gt 0 -and $maxLines -lt $limit) { $limit = $maxLines }

    for ($y = 0; $y -lt $limit; $y++) {
        $line = ""
        for ($x = 0; $x -lt $bmp.Width; $x++) {
            $p = $bmp.GetPixel($x, $y)
            if ($p.A -eq 0) {
                $line += "."
            }
            elseif ($p.R -gt 240 -and $p.G -gt 240 -and $p.B -gt 240) {
                $line += "W"
            }
            elseif ($p.R -lt 50 -and $p.G -lt 50 -and $p.B -lt 50) {
                $line += "K"
            }
            elseif ($p.G -gt $p.R -and $p.G -gt $p.B) {
                $line += "G"
            }
            else {
                $line += "#"
            }
        }
        Write-Output "$($y.ToString('000')): $line"
    }
    $bmp.Dispose()
}

Write-Output "--- PIPE 1 (dokan_under_1.png) ---"
Print-Ascii "c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_1.png" 0

Write-Output ""
Write-Output "--- PIPE 2 (dokan_under_2.png) ---"
Print-Ascii "c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_2.png" 40
