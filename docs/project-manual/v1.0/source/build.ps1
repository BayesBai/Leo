$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    for ($reportBuildPass = 1; $reportBuildPass -le 2; $reportBuildPass++) {
        & xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape main.tex
        if ($LASTEXITCODE -ne 0) { throw "XeLaTeX compilation failed on pass $reportBuildPass." }
    }
    Write-Output (Join-Path $PSScriptRoot 'main.pdf')
} finally {
    Pop-Location
}
