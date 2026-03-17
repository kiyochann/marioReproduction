$bytes1 = [IO.File]::ReadAllBytes('c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_1.png')
$bytes2 = [IO.File]::ReadAllBytes('c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_2.png')

$b1 = [Convert]::ToBase64String($bytes1)
$b2 = [Convert]::ToBase64String($bytes2)

$md = "## Pipe 1 (Horizontal Body expected)`n<img src='data:image/png;base64,$b1' style='background: #ccc'/>`n`n## Pipe 2 (Vertical expected)`n<img src='data:image/png;base64,$b2' style='background: #ccc'/>"
[IO.File]::WriteAllText('C:\Users\G2546\.gemini\antigravity\brain\c4041766-db9a-4aef-8c1e-b6b63dbcbeed\raw_images.md', $md)
