Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
try {
    $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
    $recognizer.EndSilenceTimeout = [TimeSpan]::FromSeconds(1)
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(10))
    if ($result -and $result.Text) { Write-Output $result.Text }
    else { Write-Output "__SILENCE__" }
} catch { Write-Output "__ERROR__:$($_.Exception.Message)" }
finally { $recognizer.Dispose() }
