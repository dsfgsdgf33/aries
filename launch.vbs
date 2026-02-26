Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd /c cd /d """ & WshShell.CurrentDirectory & """ && set NODE_TLS_REJECT_UNAUTHORIZED=0 && node watchdog.js > watchdog.log 2>&1", 0, False
