
Add-Type -AssemblyName System.Drawing
$img1 = [System.Drawing.Image]::FromFile("C:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_1.png")
$img2 = [System.Drawing.Image]::FromFile("C:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_2.png")

"dokan_under_1: $($img1.Width)x$($img1.Height)"
"dokan_under_2: $($img2.Width)x$($img2.Height)"

# Sample some pixels from dokan_under_2 to see if it's high res or has multiple sets
$bmp2 = new-object System.Drawing.Bitmap($img2)
"Top-Left (0,0): $($bmp2.GetPixel(0,0))"
"Middle (32,16): $($bmp2.GetPixel(32,16))"
"Bottom part (32,48): $($bmp2.GetPixel(32,48))"
"Further down (32,80): $($bmp2.GetPixel(32,80))"

$img1.Dispose()
$img2.Dispose()
$bmp2.Dispose()
