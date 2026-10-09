export const SECRET_STORAGE_CODES = [
  "unavailable",
  "locked",
  "corrupt",
  "unsupported_version",
  "conflict",
  "invalid_request",
  "cancelled",
] as const;
export type SecretStorageCode = (typeof SECRET_STORAGE_CODES)[number];

export class SecretStorageError extends Error {
  constructor(public readonly code: SecretStorageCode) {
    super(`Plugin secret storage: ${code}`);
    this.name = "SecretStorageError";
  }
}

export function secretStorageCode(error: unknown): SecretStorageCode {
  return error instanceof SecretStorageError ? error.code : "unavailable";
}
