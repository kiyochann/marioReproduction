$csv = Get-Content mario_1_1_map.csv
$rows = @()
foreach ($line in $csv) {
    if ($line.Trim() -ne "") {
        $rows += ,$line.Split(',').Trim()
    }
}

$height = $rows.Count
$width = $rows[0].Count

for ($y = 0; $y -lt $height; $y++) {
    $outLine = ""
    for ($x = 0; $x -lt $rows[$y].Count; $x++) {
        $v = $rows[$y][$x]
        $c = " "
        if ($v -eq "1") { $c = "G" }
        elseif ($v -eq "2") { $c = "#" }
        elseif ($v -eq "3") { $c = "?" }
        elseif ($v -eq "4") {
            # Pipe detection
            $isHead = $true
            if ($y -gt 0 -and $rows[$y-1][$x] -eq "4") { $isHead = $false }
            $isLeft = $true
            if ($x -gt 0 -and $rows[$y][$x-1] -eq "4") { $isLeft = $false }
            
            if ($isHead) {
                if ($isLeft) { $c = "[" } else { $c = "]" }
            } else {
                if ($isLeft) { $c = "{" } else { $c = "}" }
            }
        }
        elseif ($v -eq "5") { $c = "#" } # Stair as Ground
        elseif ($v -eq "6") { $c = "F" } # Goal Flag
        $outLine += $c
    }
    Write-Host ("`"" + $outLine + "`",")
}
