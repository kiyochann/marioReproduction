$b1 = [Convert]::ToBase64String([IO.File]::ReadAllBytes('c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_1.png'))
$b2 = [Convert]::ToBase64String([IO.File]::ReadAllBytes('c:\Users\G2546\.gemini\antigravity\scratch\super-mario-1-1\assets\pipe\dokan_under_2.png'))
$md = "# Checking new assets`n`n## Pipe 1 (4x57)`n<img src='data:image/png;base64,$b1'/>`n`n## Pipe 2 (65x129)`n<img src='data:image/png;base64,$b2'/>"
[IO.File]::WriteAllText('C:\Users\G2546\.gemini\antigravity\brain\c4041766-db9a-4aef-8c1e-b6b63dbcbeed\images2.md', $md)
