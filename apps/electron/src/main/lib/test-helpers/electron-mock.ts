export function createElectronMock(getHome: () => string) {
  return {
    app: {
      isPackaged: true,
      getPath: () => getHome(),
    },
    BrowserWindow: class {},
    clipboard: {},
    dialog: {},
    nativeImage: { createFromPath: () => ({}) },
    nativeTheme: {},
    powerMonitor: {},
    powerSaveBlocker: {},
    screen: {},
    shell: {
      openExternal: async () => undefined,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString('utf-8'),
    },
  }
}
