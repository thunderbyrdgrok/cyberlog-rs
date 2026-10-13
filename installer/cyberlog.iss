; Inno Setup script for Cyberlog. Build with: iscc /DAppVersion=1.0.1 installer\cyberlog.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6B3E5D2A-8C41-4F7B-9E1A-C7D04A2F9B61}
AppName=Cyberlog
AppVersion={#AppVersion}
AppPublisher=thunderbyrdgrok
AppPublisherURL=https://github.com/thunderbyrdgrok/cyberlog-rs
DefaultDirName={autopf}\Cyberlog
DefaultGroupName=Cyberlog
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=Cyberlog-Setup-v{#AppVersion}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\cyberlog-launcher.exe
UninstallDisplayName=Cyberlog
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=force

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\target\release\cyberlog.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\target\release\cyberlog-launcher.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Cyberlog"; Filename: "{app}\cyberlog-launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\assets\icon.ico"
Name: "{group}\Uninstall Cyberlog"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Cyberlog"; Filename: "{app}\cyberlog-launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\assets\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\cyberlog-launcher.exe"; Description: "Launch Cyberlog"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM cyberlog.exe"; Flags: runhidden; RunOnceId: "StopServer"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Stop a running server so an update can replace cyberlog.exe. }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM cyberlog.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
