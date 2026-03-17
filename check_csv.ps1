$csv = Get-Content mario_1_1_map.csv
$max = 0
$rows = @()
foreach ($l in $csv) {
    if ($l.Trim() -ne "") {
        $cols = $l.Split(',')
        $c = $cols.Count
        if ($c -gt $max) { $max = $c }
        $rows += ,$c
    }
}
Write-Host "Max Columns: $max"
for ($i=0; $i -lt $rows.Count; $i++) {
    Write-Host ("Row " + $i + ": " + $rows[$i] + " columns")
}
