; Script de Inno Setup para CHRONIT Racing System
; Compilar con Inno Setup Compiler (gratuito)

[Setup]
AppId={{CHRONIT-RACING-SYSTEM}}
AppName=CHRONIT Racing System
AppVersion=3.0
AppPublisher=Herbert Lee
AppPublisherURL=https://github.com/yingkie17
AppSupportURL=https://github.com/yingkie17/Decoder-Chronit-ESL-400-
DefaultDirName={pf}\CHRONIT Racing System
DefaultGroupName=CHRONIT Racing System
UninstallDisplayIcon={app}\CHRONIT_Launcher.exe
Compression=lzma2
SolidCompression=yes
OutputDir=installer_output
OutputBaseFilename=CHRONIT_Setup_v3.0
SetupIconFile=chronit.ico
UninstallDisplayName=CHRONIT Racing System
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Iconos adicionales:"

[Files]
Source: "CHRONIT_Launcher.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "CHRONIT_Setup.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\infrastructure\*"; DestDir: "{app}\infrastructure"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\Dockerfile"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\🏁 CHRONIT Racing System"; Filename: "{app}\CHRONIT_Launcher.exe"
Name: "{group}\🛑 Detener CHRONIT"; Filename: "{app}\CHRONIT_Stop.bat"
Name: "{group}\🔄 Reiniciar CHRONIT"; Filename: "{app}\CHRONIT_Restart.bat"
Name: "{group}\🗑️ Desinstalar CHRONIT"; Filename: "{uninstallexe}"
Name: "{autodesktop}\🏁 CHRONIT Racing System"; Filename: "{app}\CHRONIT_Launcher.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\CHRONIT_Launcher.exe"; Description: "Iniciar CHRONIT Racing System"; Flags: postinstall nowait skipifsilent

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
  DockerPath: string;
begin
  Result := True;
  
  // Verificar si Docker está instalado
  if not RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\docker.exe', '', DockerPath) then
  begin
    if MsgBox('Docker no está instalado. ¿Deseas descargarlo e instalarlo ahora?', mbConfirmation, MB_YESNO) = IDYES then
    begin
      ShellExec('open', 'https://www.docker.com/products/docker-desktop/', '', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
      MsgBox('Por favor instala Docker Desktop y luego ejecuta este instalador nuevamente.', mbInformation, MB_OK);
    end;
    Result := False;
  end;
end;
