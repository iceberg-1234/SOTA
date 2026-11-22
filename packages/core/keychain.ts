import { execFileSync } from "node:child_process";

export const KEYCHAIN_SERVICE_GEMINI = "LUMO_GEMINI_API_KEY";
export const KEYCHAIN_SERVICE_SEOUL_SUBWAY = "LUMO_SEOUL_SUBWAY_API_KEY";
export const KEYCHAIN_SERVICE_SEOUL_BUS = "LUMO_SEOUL_BUS_API_KEY";
export const KEYCHAIN_SERVICE_TMAP = "LUMO_TMAP_API_KEY";
export const KEYCHAIN_SERVICE_TRANSIT = "LUMO_KOREA_TRANSIT_API_KEY";

/**
 * Reads a secret from macOS Keychain (`security find-generic-password`) or falls back to an environment variable.
 * Never logs or exposes the raw secret value in error messages.
 */
export function getSecretFromKeychainOrEnv(
  keychainService: string,
  envVarName: string,
): string | null {
  const fromEnv = process.env[envVarName]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (process.platform === "darwin") {
    try {
      const secret = execFileSync(
        "security",
        ["find-generic-password", "-s", keychainService, "-w"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 2000,
        },
      ).trim();
      if (secret.length > 0) {
        return secret;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function maskSecretMetadata(secret: string | null): {
  configured: boolean;
  prefix: string;
  length: number;
  keyType: "AI_STUDIO" | "VERTEX_OR_EXPRESS" | "OAUTH_BEARER" | "NONE";
} {
  if (!secret) {
    return { configured: false, prefix: "none", length: 0, keyType: "NONE" };
  }
  const prefix = secret.slice(0, 3) + "***";
  const keyType = secret.startsWith("AIza")
    ? "AI_STUDIO"
    : secret.startsWith("AQ.")
      ? "VERTEX_OR_EXPRESS"
      : "OAUTH_BEARER";
  return {
    configured: true,
    prefix,
    length: secret.length,
    keyType,
  };
}
