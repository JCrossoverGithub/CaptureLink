export const PILOT_ORIGIN: string
export const PILOT_STORE_FILE: string
export type PilotSelection = {mode: 'local'} | {mode: 'remote'; origin: string; admissionToken: string}
export function loadPilotEnrollment(options: {userData: string; safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}; platform?: string}): Promise<PilotSelection>
export function importPilotEnrollment(options: {userData: string; importPath: string; safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}; platform?: string; rotate?: boolean}): Promise<{enrolled: boolean; rotated: boolean}>
export function disablePilotEnrollment(options: {userData: string}): Promise<{disabled: boolean}>
