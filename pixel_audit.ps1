
Add-Type -AssemblyName System.Drawing
$img1 = [System.Drawing.Image]::FromFile("C:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_1.png")
$img2 = [System.Drawing.Image]::FromFile("C:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_2.png")

"--- dokan_under_1 ($($img1.Width)x$($img1.Height)) ---"
$bmp1 = new-object System.Drawing.Bitmap($img1)
for ($y = 0; $y -lt $img1.Height; $y += 4) {
    $line = ""
    for ($x = 0; $x -lt $img1.Width; $x++) {
        $p = $bmp1.GetPixel($x, $y)
        if ($p.A -eq 0) { $line += "." }
        else { $line += "X" }
    }
    "$y`: $line"
}

"--- dokan_under_2 ($($img2.Width)x$($img2.Height)) ---"
$bmp2 = new-object System.Drawing.Bitmap($img2)
# Scan for non-transparent areas in a grid
for ($y = 0; $y -lt $img2.Height; $y += 16) {
    $line = ""
    for ($x = 0; $x -lt $img2.Width; $x += 4) {
        $p = $bmp2.GetPixel($x, $y)
        if ($p.A -eq 0) { $line += "." }
        else { $line += "X" }
    }
    "{0:D3}: {1}" -f $y, $line
}

$img1.Dispose(); $img2.Dispose(); $bmp1.Dispose(); $bmp2.Dispose()
