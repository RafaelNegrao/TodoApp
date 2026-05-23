# Local release pipeline. Reads the version from package.json, builds the
# single-exe artifact, creates a GitHub Release (with tag v{version}) via the
# REST API, and uploads the .exe as the only asset.
#
# Requires:
#   - A clean working tree (commit your changes first).
#   - $env:GITHUB_TOKEN set to a Personal Access Token with `repo` scope.
#     Create one at https://github.com/settings/tokens. Set it once with:
#         [Environment]::SetEnvironmentVariable('GITHUB_TOKEN', 'ghp_xxx', 'User')
#     ...or per session:
#         $env:GITHUB_TOKEN = 'ghp_xxx'
#
# Usage:
#   npm run release

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

# --- 1. Pre-flight checks ---------------------------------------------------

if (-not $env:GITHUB_TOKEN) {
    Write-Error @"
GITHUB_TOKEN env var is not set.

Create a Personal Access Token at https://github.com/settings/tokens
(scope: repo) and set it before running again, e.g.:
    `$env:GITHUB_TOKEN = 'ghp_xxx'
or permanently:
    [Environment]::SetEnvironmentVariable('GITHUB_TOKEN', 'ghp_xxx', 'User')
"@
    exit 1
}

# Switch to Continue for native git calls so harmless stderr warnings (like
# the LF/CRLF notice) don't abort the script under ErrorActionPreference=Stop.
$ErrorActionPreference = 'Continue'

$status = & git status --porcelain
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($status) {
    Write-Host $status
    Write-Error "Working tree is not clean. Commit or stash changes first."
    exit 1
}

$pkgPath = Join-Path $repoRoot 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$version = [string]$pkg.version
if (-not $version) {
    Write-Error "Could not read version from package.json"
    exit 1
}
if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    Write-Error "Version in package.json is not valid semver: '$version'"
    exit 1
}
$tag = "v$version"
$assetName = "TodoApp-$version.exe"

$existingLocal = & git tag --list $tag
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($existingLocal) {
    Write-Error "Tag $tag already exists locally. Bump version in package.json (and src-tauri/Cargo.toml + src-tauri/tauri.conf.json) first."
    exit 1
}

$remoteCheck = & git ls-remote --tags origin "refs/tags/$tag"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($remoteCheck) {
    Write-Error "Tag $tag already exists on origin. Bump version first."
    exit 1
}

$originUrl = & git config --get remote.origin.url
if ($LASTEXITCODE -ne 0 -or -not $originUrl) {
    Write-Error "Could not read origin remote URL."
    exit 1
}
if ($originUrl -notmatch 'github\.com[:/](.+?)/(.+?)(?:\.git)?/?$') {
    Write-Error "Could not parse GitHub owner/repo from origin URL: $originUrl"
    exit 1
}
$owner = $Matches[1]
$repo  = $Matches[2]

Write-Host "Releasing $tag -> $owner/$repo"

# Push the current branch so the tag created server-side points at a commit
# GitHub actually has.
Write-Host "Pushing current branch..."
& git push origin HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$headSha = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# --- 2. Build ---------------------------------------------------------------

Write-Host "Building TodoApp $version (this can take a few minutes)..."
& npm run tauri -- build --no-bundle --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) {
    Write-Error "Tauri build failed."
    exit $LASTEXITCODE
}

$buildOut = Join-Path $repoRoot 'src-tauri/target/x86_64-pc-windows-msvc/release/TodoApp.exe'
if (-not (Test-Path $buildOut)) {
    Write-Error "Build artifact not found at $buildOut"
    exit 1
}

$assetPath = Join-Path $repoRoot $assetName
Copy-Item $buildOut $assetPath -Force
Write-Host "Prepared $assetName"

# --- 3. Create release via REST API ----------------------------------------

$ErrorActionPreference = 'Stop'

$headers = @{
    'Accept'               = 'application/vnd.github+json'
    'Authorization'        = "Bearer $env:GITHUB_TOKEN"
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'TodoApp-Release-Script'
}

$releaseBody = @{
    tag_name         = $tag
    target_commitish = $headSha
    name             = "TodoApp $tag"
    body             = "Build local de $tag."
    draft            = $false
    prerelease       = $false
} | ConvertTo-Json

Write-Host "Creating GitHub release $tag..."
try {
    $release = Invoke-RestMethod `
        -Uri "https://api.github.com/repos/$owner/$repo/releases" `
        -Method Post `
        -Headers $headers `
        -Body $releaseBody `
        -ContentType 'application/json'
} catch {
    Write-Error "Failed to create release: $($_.Exception.Message)"
    exit 1
}

$uploadUrl = $release.upload_url -replace '\{\?.*\}', ''
$uploadUri = "${uploadUrl}?name=$assetName"

Write-Host "Uploading $assetName..."
$uploadHeaders = @{
    'Accept'               = 'application/vnd.github+json'
    'Authorization'        = "Bearer $env:GITHUB_TOKEN"
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'TodoApp-Release-Script'
}

try {
    $assetBytes = [System.IO.File]::ReadAllBytes($assetPath)
    Invoke-RestMethod `
        -Uri $uploadUri `
        -Method Post `
        -Headers $uploadHeaders `
        -Body $assetBytes `
        -ContentType 'application/octet-stream' | Out-Null
} catch {
    Write-Error "Failed to upload asset: $($_.Exception.Message)`nThe release was created but the .exe was not attached. Upload it manually or delete the release and re-run."
    exit 1
}

# Pull the new tag locally.
$ErrorActionPreference = 'Continue'
& git fetch origin --tags --quiet

Write-Host ""
Write-Host "Release $tag published."
Write-Host "URL: $($release.html_url)"
