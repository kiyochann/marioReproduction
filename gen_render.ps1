Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$wb = New-Object System.Windows.Forms.WebBrowser
$wb.ScrollBarsEnabled = $false
$wb.ScriptErrorsSuppressed = $true
$wb.Navigate('file:///c:/Users/G2546/.gemini/antigravity/scratch/super-mario-1-1/test_render.html')

while ($wb.ReadyState -ne 'Complete') {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
}
Start-Sleep -Milliseconds 1000

$wb.Width = 400
$wb.Height = 400

$bmp = New-Object System.Drawing.Bitmap($wb.Width, $wb.Height)
$rect = New-Object System.Drawing.Rectangle(0, 0, $wb.Width, $wb.Height)
$wb.DrawToBitmap($bmp, $rect)

$bmp.Save('c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\render_result.png')

$wb.Dispose()
$bmp.Dispose()

$bytes = [IO.File]::ReadAllBytes('c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\render_result.png')
$b64 = [Convert]::ToBase64String($bytes)
$md = "## Render Output`n<img src='data:image/png;base64,$b64'/>"
[IO.File]::WriteAllText('C:\Users\G2546\.gemini\antigravity\brain\c4041766-db9a-4aef-8c1e-b6b63dbcbeed\render_test.md', $md)
