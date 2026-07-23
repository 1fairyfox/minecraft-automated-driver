// L0 OS/host layer — Windows backend. Window enumeration, per-window screenshots
// (PrintWindow with PW_RENDERFULLCONTENT, or a screen-region fallback for GL surfaces
// that PrintWindow can't rasterize), and process open/close.
//
// Everything effectful is injectable (PowerShell runner, spawner, platform) so the
// logic is fully unit-testable on any OS; the real thing is exercised by
// scripts/os-smoke.mjs locally and in the windows-latest CI job.
import { spawn } from 'node:child_process';

/** Run a PowerShell script and resolve its stdout; injectable for tests. */
export function defaultRunPs(
  script,
  { exe = 'powershell.exe', flagArgs = ['-NoProfile', '-NonInteractive', '-Command'] } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [...flagArgs, script], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`PowerShell could not start: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`PowerShell exited ${code}: ${err.trim() || out.trim()}`));
    });
  });
}

/** Single quote a value for embedding inside a PowerShell single-quoted string. */
export function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** ConvertTo-Json emits an object for 1 result and an array for many; normalize. */
export function normalizeJsonList(stdout) {
  const text = stdout.trim();
  if (text === '') return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

const LIST_WINDOWS_PS = `
$ErrorActionPreference='Stop'
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object Id,ProcessName,MainWindowTitle,@{n='Hwnd';e={[int64]$_.MainWindowHandle}} |
  ConvertTo-Json -Compress
`;

function screenshotPs({ hwnd, outPath, method }) {
  return `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FFNative {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
$hwnd = [IntPtr]${hwnd}
$rect = New-Object FFNative+RECT
$null = [FFNative]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { throw "window ${hwnd} has empty bounds" }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
if (${psQuote(method)} -eq 'screen') {
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
} else {
  $hdc = $g.GetHdc()
  # 3 = PW_CLIENTONLY(1) is NOT wanted; 2 = PW_RENDERFULLCONTENT, |1 would clip chrome.
  $null = [FFNative]::PrintWindow($hwnd, $hdc, 2)
  $g.ReleaseHdc($hdc)
}
$g.Dispose()
$bmp.Save(${psQuote(outPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
@{ path = ${psQuote(outPath)}; width = $w; height = $h } | ConvertTo-Json -Compress
`;
}

function closePs({ pid, force, timeoutMs }) {
  return `
$ErrorActionPreference='Stop'
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($null -eq $p) {
  @{ closed = $false; forced = $false; reason = 'not-running' } | ConvertTo-Json -Compress
  exit 0
}
$null = $p.CloseMainWindow()
$exited = $p.WaitForExit(${timeoutMs})
$forced = $false
if (-not $exited -and ${force ? '$true' : '$false'}) {
  Stop-Process -Id ${pid} -Force
  $exited = $true
  $forced = $true
}
@{ closed = $exited; forced = $forced; reason = $null } | ConvertTo-Json -Compress
`;
}

/**
 * Create the Windows OS backend.
 * @param {object} deps  { runPs, spawnImpl, platform } — all injectable for tests.
 */
export function createWindowsBackend({
  runPs = defaultRunPs,
  spawnImpl = spawn,
  platform = process.platform,
} = {}) {
  function assertWindows(operation) {
    if (platform !== 'win32') {
      throw new Error(
        `${operation} needs the Windows OS layer (host platform: ${platform}). ` +
        'Other host platforms are a recorded future item (notes/plans/future.md).',
      );
    }
  }

  return {
    /** All top-level windows: [{ pid, process, title, hwnd }]. */
    async listWindows() {
      assertWindows('listWindows');
      const rows = normalizeJsonList(await runPs(LIST_WINDOWS_PS));
      return rows.map((r) => ({
        pid: r.Id,
        process: r.ProcessName,
        title: r.MainWindowTitle,
        hwnd: r.Hwnd,
      }));
    },

    /** Screenshot one window to outPath; method 'printwindow' (default) or 'screen'. */
    async screenshotWindow({ hwnd, outPath, method = 'printwindow' }) {
      assertWindows('screenshotWindow');
      if (!Number.isFinite(hwnd) || hwnd <= 0) throw new Error(`invalid hwnd: ${hwnd}`);
      if (method !== 'printwindow' && method !== 'screen') throw new Error(`unknown method: ${method}`);
      const out = await runPs(screenshotPs({ hwnd, outPath, method }));
      return JSON.parse(out.trim());
    },

    /** Graceful close (WM_CLOSE), optionally forced after timeoutMs. */
    async closeProcess({ pid, force = false, timeoutMs = 5000 }) {
      assertWindows('closeProcess');
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid: ${pid}`);
      const out = await runPs(closePs({ pid, force, timeoutMs }));
      return JSON.parse(out.trim());
    },

    /** Spawn a detached process; returns { pid }. Platform-neutral by design. */
    openProcess({ command, args = [], cwd }) {
      const child = spawnImpl(command, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return { pid: child.pid };
    },
  };
}
