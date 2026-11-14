$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path -Parent $PSScriptRoot)

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command gagal (exit $LASTEXITCODE). Rilis dihentikan." }
}

$releaseRepo = 'virgiawanprima/moss-island'
$releaseTag = 'v0.1.2'
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($releaseVersion -ne '0.1.2') { throw 'Skrip ini khusus versi 0.1.2.' }
$releaseBranch = & git branch --show-current
if ($LASTEXITCODE -ne 0 -or $releaseBranch -ne 'main') { throw 'Jalankan dari branch main.' }
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw 'Ada perubahan yang sudah di-stage. Tinjau staging sebelum menjalankan skrip ini.' }
Invoke-Checked 'gh' @('api', "repos/$releaseRepo", '--jq', '.full_name')
Invoke-Checked 'npm' @('test')
Invoke-Checked 'npm' @('run', 'lint')
Invoke-Checked 'cargo' @('check', '--locked', '--manifest-path', 'src-tauri/Cargo.toml')
Invoke-Checked 'cargo' @('test', '--locked', '--lib', '--manifest-path', 'src-tauri/Cargo.toml')

$releaseBuildStart = Get-Date
$releaseOldJobs = $env:CARGO_BUILD_JOBS
try {
    $env:CARGO_BUILD_JOBS = '1'
    Invoke-Checked 'npm' @('run', 'tauri', '--', 'build', '--bundles', 'nsis')
} finally {
    $env:CARGO_BUILD_JOBS = $releaseOldJobs
}
$releaseInstaller = 'src-tauri/target/release/bundle/nsis/moss-island_0.1.2_x64-setup.exe'
if (!(Test-Path -LiteralPath $releaseInstaller)) { throw 'Installer v0.1.2 tidak ditemukan.' }
$releaseInstallerInfo = Get-Item -LiteralPath $releaseInstaller
if ($releaseInstallerInfo.LastWriteTime -lt $releaseBuildStart) { throw 'Installer bukan hasil build baru; publikasi dibatalkan.' }
$releaseChecksum = Join-Path $releaseInstallerInfo.DirectoryName 'SHA256SUMS-v0.1.2.txt'
$releaseHash = (Get-FileHash -LiteralPath $releaseInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
"$releaseHash  $($releaseInstallerInfo.Name)" | Set-Content -LiteralPath $releaseChecksum -Encoding ascii

Invoke-Checked 'git' @('diff', '--check')
$releaseFiles = @(
    'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
    'src-tauri/tauri.conf.json', 'src/canvas/gardening.ts', 'src/canvas/gardenSchedule.ts',
    'src/canvas/islandRenderer.ts', 'src/canvas/momoLeisure.ts', 'src/canvas/momoV2Atlas.ts',
    'src/canvas/momoWander.ts', 'tests/test_suite.ts', 'docs/releases/v0.1.2.md',
    'docs/testing/taskbar-2026-11-14.md', 'docs/testing/momo-focus-2026-11-14.md',
    'scripts/publish-v0.1.2.ps1'
)
Invoke-Checked 'git' (@('add', '--') + $releaseFiles)
Invoke-Checked 'git' @('commit', '-m', 'Improve Momo wandering and activity scheduling for v0.1.2')
$releaseCommit = & git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Tidak dapat membaca commit rilis.' }
Invoke-Checked 'git' @('push', 'origin', 'HEAD:main')
Invoke-Checked 'gh' @('release', 'create', $releaseTag, $releaseInstaller, $releaseChecksum,
    '--repo', $releaseRepo, '--target', $releaseCommit, '--draft',
    '--title', 'Moss Island v0.1.2', '--notes-file', 'docs/releases/v0.1.2.md')
Invoke-Checked 'gh' @('release', 'edit', $releaseTag, '--repo', $releaseRepo, '--draft=false', '--latest')
Invoke-Checked 'gh' @('release', 'view', $releaseTag, '--repo', $releaseRepo,
    '--json', 'url,isDraft,isPrerelease,assets,targetCommitish')
