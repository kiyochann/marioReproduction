Add-Type -AssemblyName System.Drawing

function Get-ContentBounds($path) {
    if (-Not (Test-Path $path)) { return "Not found: $path" }
    $img = [System.Drawing.Bitmap]::FromFile($path)
    $minX = $img.Width
    $minY = $img.Height
    $maxX = 0
    $maxY = 0

    for ($y = 0; $y -lt $img.Height; $y++) {
        for ($x = 0; $x -lt $img.Width; $x++) {
            $pixel = $img.GetPixel($x, $y)
            if ($pixel.A -gt 0) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    
    if ($maxX -ge $minX) {
        $w = $maxX - $minX + 1
        $h = $maxY - $minY + 1
        return "MinX:$minX MinY:$minY MaxX:$maxX MaxY:$maxY (Size:${w}x${h})"
    } else {
        return "Empty"
    }
}

Write-Output "Half1: $(Get-ContentBounds 'c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_1.png')"
Write-Output "Half2: $(Get-ContentBounds 'c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_2.png')"
