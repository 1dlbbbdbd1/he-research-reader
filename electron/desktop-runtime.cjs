function configureDesktopRuntime(app, options = {}) {
  const platform = options.platform || process.platform
  const smokeRequested = options.smokeRequested
    ?? process.env.RESEARCH_READER_DESKTOP_SMOKE === '1'
  const isolatedTestRequested = options.isolatedTestRequested
    ?? process.env.RESEARCH_READER_ISOLATED_DESKTOP_TEST === '1'
  const managedCodexSession = options.managedCodexSession
    ?? Boolean(String(process.env.CODEX_THREAD_ID || '').trim())
  const isDesktopSmoke = !app.isPackaged && smokeRequested
  const usesIsolatedWindowsTestCompatibility = platform === 'win32'
    && !app.isPackaged
    && (isolatedTestRequested || managedCodexSession)

  if (usesIsolatedWindowsTestCompatibility) {
    // Managed Windows development sessions can prevent Chromium's sandboxed
    // GPU helper from loading (0xC0000135). Chromium then terminates Electron
    // with the visible 0x80000003 breakpoint dialog. Keep graphics in-process
    // for the dedicated isolated test command only. Electron documents
    // no-sandbox as a testing-only switch; the normal dev entry and packaged
    // applications never enter this branch.
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('in-process-gpu')
    app.commandLine.appendSwitch('no-sandbox')
  }

  return {
    isDesktopSmoke,
    managedCodexSession,
    usesIsolatedWindowsTestCompatibility,
  }
}

module.exports = { configureDesktopRuntime }
