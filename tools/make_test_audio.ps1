# Synthesizes test calls with the Windows voices installed on this machine (offline, no cloud, no real people).
#   pwsh tools/make_test_audio.ps1            -> tools/test_audio/*.wav  (git-ignored; regenerate any time)
# Use them in Live Guard > "Test tools", in Quick Check (audio upload), or play them next to the microphone.
# 16 kHz mono PCM16 = what speech recognizers expect. A pause between lines mimics turn-taking on a call.
#   pwsh tools/make_test_audio.ps1 -Engine fci   -> also *_fci.wav for calls that name an `fci_voice`, through an
#        OpenAI-compatible /v1/audio/speech endpoint (OPENAI_BASE_URL / OPENAI_API_KEY / FCI_TTS_MODEL in .env).
#        More natural than the Windows voices - a harder, more realistic test for the recognizer. Test data only.
param([string]$OutDir = "$PSScriptRoot/test_audio", [int]$PauseMs = 900, [ValidateSet("windows", "fci")][string]$Engine = "windows",
      [string]$CallsFile = "$PSScriptRoot/test_calls.json")  # another script file, e.g. tools/stt_eval_calls.json (not "$Calls": PowerShell names are case-insensitive)
Add-Type -AssemblyName System.Speech
$calls = Get-Content $CallsFile -Raw -Encoding utf8 | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutDir | Out-Null
$format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($call in $calls) {
    $synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq $call.culture } |
        Sort-Object { $_.VoiceInfo.Name -ne $call.voice } | Select-Object -First 1   # preferred voice first, else any of that language
    if (-not $voice) { Write-Warning "no $($call.culture) voice installed - skipped $($call.name)"; continue }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $synth.Rate = -1
    $path = Join-Path $OutDir "$($call.name).wav"
    $synth.SetOutputToWaveFile($path, $format)
    $prompt = [System.Speech.Synthesis.PromptBuilder]::new([cultureinfo]$call.culture)
    foreach ($line in $call.lines) {
        $prompt.AppendText($line)
        $prompt.AppendBreak([timespan]::FromMilliseconds($PauseMs))
    }
    $synth.Speak($prompt)
    $synth.Dispose()
    "{0,-28} {1,5:N0} KB  expect {2,-6} ({3})" -f "$($call.name).wav", ((Get-Item $path).Length / 1KB), $call.expect, $voice.VoiceInfo.Name
}

if ($Engine -eq "fci") {
    $cfg = @{}
    Get-Content "$PSScriptRoot/../.env" | Where-Object { $_ -match '^\s*([A-Za-z_]+)=(.*)$' } | ForEach-Object { $cfg[$Matches[1]] = $Matches[2].Trim() }
    $url = $cfg.OPENAI_BASE_URL.TrimEnd('/') + "/v1/audio/speech"
    foreach ($call in $calls | Where-Object { $_.fci_voice }) {
        $path = Join-Path $OutDir "$($call.name)_fci.wav"
        $body = @{ model = $cfg.FCI_TTS_MODEL; input = ($call.lines -join "`n"); response_format = "wav"; voice = $call.fci_voice } | ConvertTo-Json
        try {
            Invoke-WebRequest -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -OutFile $path `
                -Headers @{ Authorization = "Bearer $($cfg.OPENAI_API_KEY)" } -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
            "{0,-28} {1,5:N0} KB  expect {2,-6} ({3} / {4})" -f "$($call.name)_fci.wav", ((Get-Item $path).Length / 1KB), $call.expect, $cfg.FCI_TTS_MODEL, $call.fci_voice
        } catch { Write-Warning "$($call.name): $($_.ErrorDetails.Message ?? $_.Exception.Message)" }  # e.g. model not allowed for this key
    }
}
