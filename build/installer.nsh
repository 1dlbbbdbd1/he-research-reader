!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifdef BUILD_UNINSTALLER
!macro customUnInstall
  # Argos/Stanza rewrites a packaged metadata file on first use. The default
  # electron-builder uninstaller preserves modified files, so remove only the
  # optional runtime that was installed under the application directory.
  RMDir /r "$INSTDIR\resources\translation-runtime"
!macroend
!else
Var InstallLocalTranslation
Var LocalTranslationCheckbox

!if /FileExists "${PROJECT_DIR}\.runtime\translation\argos\.venv\Scripts\python.exe"
  !define READER_BUNDLED_TRANSLATION_AVAILABLE
!endif

!macro customInit
  StrCpy $InstallLocalTranslation ${BST_CHECKED}
!macroend

!macro customPageAfterChangeDir
  !ifdef READER_BUNDLED_TRANSLATION_AVAILABLE
    Page custom ReaderTranslationPageCreate ReaderTranslationPageLeave
  !endif
!macroend

Function ReaderTranslationPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 34u "可选本地组件"
  Pop $0
  CreateFont $1 "$(^Font)" "12" "700"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 0 38u 100% 42u "英文 → 中文翻译可以完全在本机运行，不需要第三方 Token。该组件安装后约占 1.0 GB；安装包本身已包含组件，因此这里不再联网下载。"
  Pop $0

  ${NSD_CreateCheckbox} 0 90u 100% 18u "安装 Argos 本地翻译模块（推荐）"
  Pop $LocalTranslationCheckbox
  ${NSD_SetState} $LocalTranslationCheckbox $InstallLocalTranslation

  ${NSD_CreateLabel} 20u 114u 95% 44u "如果不安装，软件仍可正常阅读和批注。首次使用翻译时会提示安装本地模块，或者前往设置配置兼容 API。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function ReaderTranslationPageLeave
  ${NSD_GetState} $LocalTranslationCheckbox $InstallLocalTranslation
FunctionEnd

!macro customInstall
  !ifdef READER_BUNDLED_TRANSLATION_AVAILABLE
    ${If} $InstallLocalTranslation == ${BST_CHECKED}
      DetailPrint "正在安装 Argos 本地翻译模块…"
      SetOutPath "$INSTDIR\resources\translation-runtime\argos"
      File /r "${PROJECT_DIR}\.runtime\translation\argos\*.*"
      SetOutPath "$INSTDIR\resources\translation-runtime\packages"
      File /r "${PROJECT_DIR}\.runtime\translation\packages\*.*"
      SetOutPath "$INSTDIR\resources\translation-runtime\python"
      File /r "${PROJECT_DIR}\.runtime\translation\python\*.*"
      SetOutPath "$INSTDIR\resources\translation-runtime"
      File "${PROJECT_DIR}\resources\translation-runtime\NOTICE.txt"

      FindFirst $0 $1 "$INSTDIR\resources\translation-runtime\python\cpython-*"
      ${If} $1 != ""
        FileOpen $2 "$INSTDIR\resources\translation-runtime\argos\.venv\pyvenv.cfg" w
        FileWrite $2 "home = $INSTDIR\resources\translation-runtime\python\$1$\r$\n"
        FileWrite $2 "implementation = CPython$\r$\n"
        FileWrite $2 "uv = 0.11.32$\r$\n"
        FileWrite $2 "version_info = 3.12$\r$\n"
        FileWrite $2 "include-system-site-packages = false$\r$\n"
        FileClose $2
      ${EndIf}
      FindClose $0
      SetOutPath "$INSTDIR"
    ${Else}
      RMDir /r "$INSTDIR\resources\translation-runtime"
    ${EndIf}
  !endif
!macroend
!endif
