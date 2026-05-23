# Bumps the version across package.json, src-tauri/tauri.conf.json and
# src-tauri/Cargo.toml, commits the change, creates a vX.Y.Z tag, and pushes
# both the branch and the tag. The tag triggers .github/workflows/release.yml
# which builds the installer, signs it, and publishes to GitHub Releases.
#
# Usage:
#   npm run release -- 0.1.1

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $Version
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    Write-Error "Version must be semver (X.Y.Z or X.Y.Z-suffix). Got: '$Version'"
    exit 1
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

# Refuse to release with uncommitted changes - the tag commit would otherwise
# carry unrelated work.
$status = & git status --porcelain
if ($status) {
    Write-Error "Working tree is not clean. Commit or stash changes first."
    exit 1
}

# Refuse to overwrite an existing tag.
$existing = & git tag --list "v$Version"
if ($existing) {
    Write-Error "Tag v$Version already exists."
    exit 1
}

function Update-FileContent {
    param(
        [string] $Path,
        [string] $Pattern,
        [string] $Replacement
    )
    $full = Join-Path $repoRoot $Path
    $content = [System.IO.File]::ReadAllText($full)
    if ($content -notmatch $Pattern) {
        Write-Error "Pattern not found in $Path"
        exit 1
    }
    $updated = [regex]::Replace($content, $Pattern, $Replacement)
    # UTF-8 without BOM, preserving original line endings.
    [System.IO.File]::WriteAllText($full, $updated, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "Bumping to v$Version..."

# package.json - first "version": "..."
Update-FileContent -Path 'package.json' `
    -Pattern '("version"\s*:\s*")[^"]+(")' `
    -Replacement "`${1}$Version`${2}"

# src-tauri/tauri.conf.json - first "version": "..."
Update-FileContent -Path 'src-tauri/tauri.conf.json' `
    -Pattern '("version"\s*:\s*")[^"]+(")' `
    -Replacement "`${1}$Version`${2}"

# src-tauri/Cargo.toml - the top-level package version line only
Update-FileContent -Path 'src-tauri/Cargo.toml' `
    -Pattern '(?m)^version\s*=\s*"[^"]+"' `
    -Replacement "version = `"$Version`""

# Windows PowerShell 5.1 wraps any stderr line from native exes (including
# harmless `git add` CRLF warnings) as a NativeCommandError under
# ErrorActionPreference=Stop, killing the script before $LASTEXITCODE is
# checked. Switch to Continue for the git invocations below.
$ErrorActionPreference = 'Continue'

Write-Host "Committing..."
& git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& git commit -m "release: v$Version"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Tagging v$Version..."
& git tag "v$Version"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Pushing..."
& git push origin HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& git push origin "v$Version"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Release v$Version dispatched."
Write-Host "Watch the build: https://github.com/RafaelNegrao/TodoApp/actions"
