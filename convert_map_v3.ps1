$csvLines = Get-Content mario_1_1_map.csv
$rows = @()
$maxWidth = 0
foreach ($line in $csvLines) {
    if ($line.Trim() -ne "") {
        $cols = $line.Split(',').Trim()
        $rows += ,$cols
        if ($cols.Count -gt $maxWidth) { $maxWidth = $cols.Count }
    }
}

$jsLines = @()
for ($y = 0; $y -lt $rows.Count; $y++) {
    $outString = ""
    for ($x = 0; $x -lt $maxWidth; $x++) {
        $v = "0"
        if ($x -lt $rows[$y].Count) { $v = $rows[$y][$x] }
        
        $char = " "
        if ($v -eq "1") { $char = "G" }
        elseif ($v -eq "2") { $char = "#" }
        elseif ($v -eq "3") { $char = "?" }
        elseif ($v -eq "4") {
            # Pipe detection
            $isHead = $true
            if ($y -gt 0 -and $x -lt $rows[$y-1].Count -and $rows[$y-1][$x] -eq "4") { $isHead = $false }
            $isLeft = $true
            if ($x -gt 0 -and $rows[$y][$x-1] -eq "4") { $isLeft = $false }
            
            if ($isHead) {
                if ($isLeft) { $char = "[" } else { $char = "]" }
            } else {
                if ($isLeft) { $char = "{" } else { $char = "}" }
            }
        }
        elseif ($v -eq "5") { $char = "G" }
        elseif ($v -eq "6") { $char = "F" }
        $outString += $char
    }
    $jsLines += "`"$outString`","
}
$jsLines | Out-File -FilePath final_level_data.txt -Encoding utf8
