!macro jinkraUninstallWizard
  ${IfNot} ${Silent}
    IfFileExists "$INSTDIR\resources\jinkra-uninstall-ui.exe" 0 jinkra_uninstall_native
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 jinkra_uninstall_native
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    ClearErrors
    CopyFiles /SILENT "$INSTDIR\resources\jinkra-uninstall-ui.exe" "$PLUGINSDIR"
    IfErrors jinkra_uninstall_native
    ExecWait '"$PLUGINSDIR\jinkra-uninstall-ui.exe" --uninstall "$INSTDIR"' $R8
    IfErrors jinkra_uninstall_native
    SetErrorLevel $R8
    Quit
  jinkra_uninstall_native:
    SetOutPath "$INSTDIR"
  ${EndIf}
!macroend

!macro customInstall
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "/JINKRA_QUICK_LAUNCH" $R9
  ${IfNot} ${Errors}
    ${IfNot} ${FileExists} "$QUICKLAUNCH\Jinkra-Toolbox.lnk"
      CreateDirectory "$QUICKLAUNCH"
      ClearErrors
      CreateShortCut "$QUICKLAUNCH\Jinkra-Toolbox.lnk" "$appExe" "" "$appExe" 0
      ${IfNot} ${Errors}
        WinShell::SetLnkAUMI "$QUICKLAUNCH\Jinkra-Toolbox.lnk" "${APP_ID}"
        WriteRegStr HKCU "Software\Jinkra\Toolbox" "QuickLaunchTarget" "$appExe"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isKeepShortcuts}
    ReadRegStr $R8 HKCU "Software\Jinkra\Toolbox" "QuickLaunchTarget"
    ${If} $R8 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      WinShell::UninstShortcut "$QUICKLAUNCH\Jinkra-Toolbox.lnk"
      Delete "$QUICKLAUNCH\Jinkra-Toolbox.lnk"
      DeleteRegValue HKCU "Software\Jinkra\Toolbox" "QuickLaunchTarget"
    ${EndIf}
    DeleteRegValue HKCU "Software\Jinkra\Toolbox" "InstallLocation"
    DeleteRegKey /ifempty HKCU "Software\Jinkra\Toolbox"
  ${EndIf}
!macroend
