; SentinelX AI — Custom NSIS Lifecycle Script
; Handles process termination and file lock prevention for SentinelX User, Admin and Python backend.

!macro preInit
  ; Terminate any previous instance before initialization
  nsExec::Exec 'taskkill /f /im "SentinelX AI.exe"'
  nsExec::Exec 'taskkill /f /im "SentinelX Admin.exe"'
  nsExec::Exec 'taskkill /f /im "sentinelx_backend.exe"'
!macroend

!macro customInit
  ; Terminate any lingering processes before file copy/check operations begin
  nsExec::Exec 'taskkill /f /im "SentinelX AI.exe"'
  nsExec::Exec 'taskkill /f /im "SentinelX Admin.exe"'
  nsExec::Exec 'taskkill /f /im "sentinelx_backend.exe"'
  Sleep 500
!macroend

!macro customInstall
  ; Clear any stale file attributes on installed files if upgrading
  ${if} ${FileExists} "$INSTDIR\Uninstall SentinelX AI.exe"
    SetFileAttributes "$INSTDIR\Uninstall SentinelX AI.exe" NORMAL
  ${endif}
  ${if} ${FileExists} "$INSTDIR\Uninstall SentinelX Admin.exe"
    SetFileAttributes "$INSTDIR\Uninstall SentinelX Admin.exe" NORMAL
  ${endif}
!macroend

!macro customUnInit
  ; Terminate running processes before uninstallation begins
  nsExec::Exec 'taskkill /f /im "SentinelX AI.exe"'
  nsExec::Exec 'taskkill /f /im "SentinelX Admin.exe"'
  nsExec::Exec 'taskkill /f /im "sentinelx_backend.exe"'
  Sleep 500
!macroend
