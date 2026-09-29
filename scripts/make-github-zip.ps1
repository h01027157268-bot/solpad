# Builds a clean zip of the repository that can be dragged straight into
# GitHub's web uploader - no git required.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-github-zip.ps1
#
# Excludes everything that must not be committed: dependencies, build output,
# key material and logs. The result lands on the Desktop.

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$desktop = [Environment]::GetFolderPath('Desktop')
$zipPath = Join-Path $desktop "solpad-github-$stamp.zip"
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "solpad-zip-$stamp"

$excludeDirs = @('node_modules', '.next', 'target', '.git', 'keys', '.tmp-test', '.anchor', 'test-ledger', 'out', '.vercel', 'dist')
$excludeFiles = @('*.log', '*.keypair.json', '.env', '.env.local', 'tsconfig.tsbuildinfo', '.DS_Store')
$copied = 0

function Copy-Tree {
  param([string]$Dir, [string]$Relative)

  foreach ($item in Get-ChildItem -LiteralPath $Dir -Force -ErrorAction SilentlyContinue) {
    $rel = if ($Relative) { Join-Path $Relative $item.Name } else { $item.Name }
    if ($item.PSIsContainer) {
      if ($excludeDirs -contains $item.Name) { continue }
      Copy-Tree -Dir $item.FullName -Relative $rel
      continue
    }
    $skip = $false
    foreach ($pattern in $excludeFiles) { if ($item.Name -like $pattern) { $skip = $true; break } }
    if ($skip) { continue }
    $destination = Join-Path $staging $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $item.FullName -Destination $destination -Force
    $script:copied++
  }
}

New-Item -ItemType Directory -Force -Path $staging | Out-Null
Write-Host "staging $root"
Copy-Tree -Dir $root -Relative ''

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("files : {0}" -f $copied)
Write-Host ("zip   : {0}  ({1} KB)" -f $zipPath, [Math]::Round((Get-Item $zipPath).Length / 1KB, 1))
Write-Host ""
Write-Host "next  : unzip it, then github.com -> New repository (Public) -> Add file -> Upload files -> drag the contents in"
