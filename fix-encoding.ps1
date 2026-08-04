# Reverse UTF-8-read-as-cp1252 double encoding. ASCII content (incl. hex replacements) is unaffected.
$ErrorActionPreference = 'Stop'
$enc1252 = [Text.Encoding]::GetEncoding(1252, (New-Object Text.EncoderExceptionFallback), (New-Object Text.DecoderExceptionFallback))
$utf8strict = New-Object Text.UTF8Encoding($false, $true)

$files = @(Get-Item 'index.html', 'src/App.tsx', 'src/index.css') +
  @(Get-ChildItem 'src/components' -Filter '*.tsx') +
  @(Get-ChildItem 'src/styles' -Filter '*.css')

foreach ($f in $files) {
  $bytes = [IO.File]::ReadAllBytes($f.FullName)
  try { $moji = $utf8strict.GetString($bytes) } catch { Write-Host "SKIP (not utf8): $($f.Name)"; continue }
  try {
    $origBytes = $enc1252.GetBytes($moji)
    $orig = $utf8strict.GetString($origBytes)
  } catch {
    Write-Host "SKIP (not double-encoded): $($f.Name)"
    continue
  }
  if ($orig -ne $moji) {
    [IO.File]::WriteAllBytes($f.FullName, $origBytes)
    Write-Host "fixed: $($f.Name)"
  }
}
Write-Host 'done'
