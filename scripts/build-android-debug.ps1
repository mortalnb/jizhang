[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [string]$WorkingDirectory
    )

    $exitCode = $null
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($null -eq $exitCode -or $exitCode -ne 0) {
        throw "Native command failed with exit code $exitCode`: $FilePath $($Arguments -join ' ')"
    }
}

function Get-AndroidSdkPath {
    param([Parameter(Mandatory)] [string]$ProjectRoot)

    $propertiesPath = Join-Path $ProjectRoot 'android\local.properties'
    if (-not (Test-Path -LiteralPath $propertiesPath -PathType Leaf)) {
        throw 'android/local.properties is missing. Configure sdk.dir before building.'
    }

    $content = Get-Content -Raw -Encoding utf8 -LiteralPath $propertiesPath
    $match = [regex]::Match($content, '(?m)^\s*sdk\.dir=(.+?)\s*$')
    if (-not $match.Success) {
        throw 'android/local.properties does not contain sdk.dir.'
    }

    $configured = $match.Groups[1].Value.Trim().Replace('\:', ':').Replace('\\', '\').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $sdkPath = [IO.Path]::GetFullPath($configured)
    if (-not (Test-Path -LiteralPath $sdkPath -PathType Container)) {
        throw "Configured Android SDK does not exist: $sdkPath"
    }
    return $sdkPath
}

function Resolve-Java21 {
    param([Parameter(Mandatory)] [string]$AndroidSdkPath)

    $homes = [Collections.Generic.List[string]]::new()
    foreach ($candidate in @($env:JIZHANG_JAVA_HOME, $env:JAVA_HOME)) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $homes.Add($candidate)
        }
    }

    $toolchainRoot = Split-Path -Parent $AndroidSdkPath
    if (Test-Path -LiteralPath $toolchainRoot -PathType Container) {
        $javaExecutables = Get-ChildItem -LiteralPath $toolchainRoot -Filter java.exe -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '[\\/]bin[\\/]java\.exe$' }
        foreach ($javaExecutable in $javaExecutables) {
            $homes.Add((Split-Path -Parent (Split-Path -Parent $javaExecutable.FullName)))
        }
    }

    $pathJava = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($pathJava) {
        $homes.Add((Split-Path -Parent (Split-Path -Parent $pathJava.Source)))
    }

    foreach ($candidateHome in $homes | Select-Object -Unique) {
        $javaExecutable = Join-Path $candidateHome 'bin\java.exe'
        if (-not (Test-Path -LiteralPath $javaExecutable -PathType Leaf)) {
            continue
        }
        $versionLines = & $javaExecutable -version 2>&1
        $exitCode = $LASTEXITCODE
        $versionText = $versionLines -join "`n"
        $versionMatch = [regex]::Match($versionText, 'version\s+"(\d+)(?:\.|"|-)')
        if ($exitCode -eq 0 -and $versionMatch.Success -and [int]$versionMatch.Groups[1].Value -eq 21) {
            return [pscustomobject]@{
                Home = (Resolve-Path -LiteralPath $candidateHome).Path
                Executable = (Resolve-Path -LiteralPath $javaExecutable).Path
                Version = $versionText.Split("`n")[0]
            }
        }
    }

    throw 'JDK 21 was not found. Set JIZHANG_JAVA_HOME/JAVA_HOME or place a JDK 21 beside the configured Android SDK.'
}

function Get-AndroidBuildTools {
    param([Parameter(Mandatory)] [string]$AndroidSdkPath)

    $root = Join-Path $AndroidSdkPath 'build-tools'
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "Android build-tools directory is missing: $root"
    }

    $candidates = Get-ChildItem -Directory -LiteralPath $root | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName 'aapt2.exe')) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'apksigner.bat'))
    } | Sort-Object -Property @{ Expression = {
        try { [version]$_.Name } catch { [version]'0.0' }
    }; Descending = $true }

    $selected = $candidates | Select-Object -First 1
    if (-not $selected) {
        throw 'No Android build-tools installation contains both aapt2.exe and apksigner.bat.'
    }

    return [pscustomobject]@{
        Version = $selected.Name
        Aapt2 = Join-Path $selected.FullName 'aapt2.exe'
        ApkSigner = Join-Path $selected.FullName 'apksigner.bat'
    }
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'PowerShell 7 or newer is required.'
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$packagePath = Join-Path $projectRoot 'package.json'
$lockPath = Join-Path $projectRoot 'package-lock.json'
$package = Get-Content -Raw -Encoding utf8 -LiteralPath $packagePath | ConvertFrom-Json
$lock = Get-Content -Raw -Encoding utf8 -LiteralPath $lockPath | ConvertFrom-Json -AsHashtable
if ($package.name -ne 'jizhang' -or $lock['name'] -ne $package.name -or $lock['version'] -ne $package.version) {
    throw 'package.json and package-lock.json identity/version metadata are inconsistent.'
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $npmCommand) {
    throw 'npm was not found.'
}

$sdkPath = Get-AndroidSdkPath -ProjectRoot $projectRoot
$java = Resolve-Java21 -AndroidSdkPath $sdkPath
$buildTools = Get-AndroidBuildTools -AndroidSdkPath $sdkPath
$keystorePath = Join-Path $projectRoot 'debug.keystore'
if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
    throw 'debug.keystore is missing; rebuilding would break APK signing continuity.'
}

Write-Host "Project: $($package.name) $($package.version)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "Android SDK: $sdkPath"
Write-Host "Android build-tools: $($buildTools.Version)"
Write-Host "JDK: $($java.Version)"
Write-Host 'Signing input: debug.keystore present'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'key.txt') -PathType Leaf)) {
    Write-Warning 'key.txt is absent; local real-MiMo tests will be unavailable, but Android packaging can continue.'
}

if ($PreflightOnly) {
    Write-Host 'Project toolchain preflight passed.'
    exit 0
}

$previousJavaHome = $env:JAVA_HOME
$previousPath = $env:PATH
$env:JAVA_HOME = $java.Home
$env:PATH = "$(Join-Path $java.Home 'bin');$env:PATH"
try {
    Invoke-NativeChecked -FilePath $npmCommand.Source -Arguments @('run', 'android:sync') -WorkingDirectory $projectRoot

    $androidRoot = Join-Path $projectRoot 'android'
    $gradleWrapper = Join-Path $androidRoot 'gradlew.bat'
    if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf)) {
        throw 'android/gradlew.bat is missing.'
    }
    Invoke-NativeChecked -FilePath $gradleWrapper -Arguments @('--no-daemon', '--no-problems-report', 'assembleDebug') -WorkingDirectory $androidRoot

    $sourceApk = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $sourceApk -PathType Leaf)) {
        throw "Gradle completed without the expected APK: $sourceApk"
    }

    $capacitorConfig = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $projectRoot 'capacitor.config.ts')
    $appIdMatch = [regex]::Match($capacitorConfig, 'appId\s*:\s*[''"]([^''"]+)[''"]')
    if (-not $appIdMatch.Success) {
        throw 'Could not read appId from capacitor.config.ts.'
    }

    $gradleConfig = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $androidRoot 'app\build.gradle')
    $versionCodeMatch = [regex]::Match($gradleConfig, 'versionCode\s+(\d+)')
    if (-not $versionCodeMatch.Success) {
        throw 'Could not read versionCode from android/app/build.gradle.'
    }

    $badgingLines = & $buildTools.Aapt2 dump badging $sourceApk 2>&1
    $badgingExit = $LASTEXITCODE
    if ($badgingExit -ne 0) {
        throw "aapt2 badging check failed with exit code $badgingExit."
    }
    $badging = $badgingLines -join "`n"
    $packageMatch = [regex]::Match($badging, "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
    if (-not $packageMatch.Success) {
        throw 'Could not parse APK package metadata.'
    }
    if ($packageMatch.Groups[1].Value -ne $appIdMatch.Groups[1].Value -or
        $packageMatch.Groups[2].Value -ne $versionCodeMatch.Groups[1].Value -or
        $packageMatch.Groups[3].Value -ne $package.version) {
        throw "APK metadata mismatch: $($packageMatch.Value)"
    }

    $permissionLines = & $buildTools.Aapt2 dump permissions $sourceApk 2>&1
    $permissionExit = $LASTEXITCODE
    if ($permissionExit -ne 0 -or ($permissionLines -join "`n") -notmatch 'android\.permission\.RECORD_AUDIO') {
        throw 'APK does not contain the required android.permission.RECORD_AUDIO permission.'
    }

    $signerLines = & $buildTools.ApkSigner verify --verbose --print-certs $sourceApk 2>&1
    $signerExit = $LASTEXITCODE
    $signerText = $signerLines -join "`n"
    if ($signerExit -ne 0 -or $signerText -notmatch 'Verified using v2 scheme.*:\s*true') {
        throw 'APK signature verification or v2 signing check failed.'
    }
    $digestMatch = [regex]::Match($signerText, 'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
    if (-not $digestMatch.Success) {
        throw 'Could not read APK signing certificate digest.'
    }
    $expectedDigest = (Get-Content -Raw -Encoding ascii -LiteralPath (Join-Path $PSScriptRoot 'android-signing-cert.sha256')).Trim().ToLowerInvariant()
    if ($digestMatch.Groups[1].Value.ToLowerInvariant() -ne $expectedDigest) {
        throw 'APK signer differs from the accepted upgrade-signing certificate.'
    }

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = Join-Path $projectRoot "jizhang-v$($package.version)-debug.apk"
    }
    elseif (-not [IO.Path]::IsPathRooted($OutputPath)) {
        $OutputPath = Join-Path $projectRoot $OutputPath
    }

    Copy-Item -LiteralPath $sourceApk -Destination $OutputPath -Force
    $artifact = Get-Item -LiteralPath $OutputPath
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $artifact.FullName
    Write-Host 'Android debug APK verified.'
    Write-Host "Artifact: $($artifact.FullName)"
    Write-Host "Bytes: $($artifact.Length)"
    Write-Host "SHA256: $($hash.Hash)"
    Write-Host "Package: $($packageMatch.Groups[1].Value)"
    Write-Host "Version: $($packageMatch.Groups[3].Value) ($($packageMatch.Groups[2].Value))"
    Write-Host "Signer SHA256: $expectedDigest"
}
finally {
    $env:JAVA_HOME = $previousJavaHome
    $env:PATH = $previousPath
}
