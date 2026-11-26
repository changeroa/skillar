export class SkillarStartupError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "SkillarStartupError";
    this.code = code;
  }
}

export const MIN_BUN = "1.4.5";

export function assertBunVersion(version = Bun.version): void {
  if (!Bun.semver.satisfies(version, `>=${MIN_BUN}`)) {
    throw new SkillarStartupError("bun_too_old", `skillar needs Bun >= ${MIN_BUN}, found ${version}`);
  }
}

export function assertPlatform(platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") throw new SkillarStartupError("unsupported_platform", "skillar supports macOS and Linux");
}
