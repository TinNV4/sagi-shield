# Synthesizes test calls with the Windows voices installed on this machine (offline, no cloud, no real people).
#   pwsh tools/make_test_audio.ps1            -> tools/test_audio/*.wav  (git-ignored; regenerate any time)
# Use them in Live Guard > "Test tools", in Quick Check (audio upload), or play them next to the microphone.
# 16 kHz mono PCM16 = what speech recognizers expect. A pause between lines mimics turn-taking on a call.
param([string]$OutDir = "$PSScriptRoot/test_audio", [int]$PauseMs = 900)
Add-Type -AssemblyName System.Speech
$calls = Get-Content "$PSScriptRoot/test_calls.json" -Raw -Encoding utf8 | ConvertFrom-Json
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
