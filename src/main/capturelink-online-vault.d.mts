export function createWindowsOnlineVault(config: {
  userData: string
  safeStorage: {
    isEncryptionAvailable(): boolean
    encryptString(plainText: string): Buffer
    decryptString(encrypted: Buffer): string
  }
}): {
  load(): Promise<unknown>
  save(value: unknown): Promise<void>
  clear(): Promise<void>
}
