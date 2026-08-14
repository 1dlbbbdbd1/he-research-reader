param([Parameter(Mandatory=$true)][string]$PayloadBase64)
$ErrorActionPreference = 'Stop'
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WorkbenchInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public UIntPtr time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
  public static string Title(IntPtr handle) { var value = new StringBuilder(1024); GetWindowText(handle, value, value.Capacity); return value.ToString(); }
  public static void Click(int x, int y) { if (!SetCursorPos(x, y)) throw new InvalidOperationException("cursor-position-failed"); mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero); mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero); }
  public static void Text(string value) { foreach (char c in value) { var down = new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE } } }; var up = down; up.U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP; if (SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(INPUT))) != 2) throw new InvalidOperationException("unicode-input-failed"); } }
  public static void Key(ushort key) { var down = new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = key } } }; var up = down; up.U.ki.dwFlags = KEYEVENTF_KEYUP; if (SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(INPUT))) != 2) throw new InvalidOperationException("key-input-failed"); }
}
'@

$expectedHandle = [IntPtr]([Int64]$payload.windowHandle)
$foreground = [WorkbenchInput]::GetForegroundWindow()
if ($foreground -ne $expectedHandle) { throw 'Authorized window is not the foreground window.' }
$title = [WorkbenchInput]::Title($foreground)
if ([string]::IsNullOrWhiteSpace($title) -or $title -ne [string]$payload.expectedTitle) { throw 'Authorized window title changed.' }
$rect = New-Object WorkbenchInput+RECT
if (-not [WorkbenchInput]::GetWindowRect($foreground, [ref]$rect)) { throw 'Unable to read authorized window bounds.' }

$action = $payload.action
switch ([string]$action.type) {
  'click' {
    $x = [int]$action.x; $y = [int]$action.y
    $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
    if ($x -lt 0 -or $y -lt 0 -or $x -ge $width -or $y -ge $height) { throw 'Click coordinate is outside the authorized window.' }
    [WorkbenchInput]::Click($rect.Left + $x, $rect.Top + $y)
  }
  'text' {
    $value = [string]$action.text
    if ($value.Length -gt 2000) { throw 'Text input exceeds 2000 characters.' }
    [WorkbenchInput]::Text($value)
  }
  'key' {
    $keys = @{ ENTER = 0x0D; TAB = 0x09; ESCAPE = 0x1B; BACKSPACE = 0x08; DELETE = 0x2E; UP = 0x26; DOWN = 0x28; LEFT = 0x25; RIGHT = 0x27 }
    $name = ([string]$action.key).ToUpperInvariant()
    if (-not $keys.ContainsKey($name)) { throw 'Key is not in the fixed allowlist.' }
    [WorkbenchInput]::Key([uint16]$keys[$name])
  }
  default { throw 'Unsupported desktop input action.' }
}

Start-Sleep -Milliseconds 250
$afterHandle = [WorkbenchInput]::GetForegroundWindow()
$afterTitle = [WorkbenchInput]::Title($afterHandle)
if ($afterHandle -ne $expectedHandle -or $afterTitle -ne $title) { throw 'Window changed after input; desktop control must pause.' }
[pscustomobject]@{ performed = $true; windowHandle = [Int64]$expectedHandle; title = $title; actionType = [string]$action.type } | ConvertTo-Json -Compress
