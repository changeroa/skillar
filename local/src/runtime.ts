import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const standalone = Bun.main.startsWith("/$bunfs/");
export const packageRoot = () => standalone ? dirname(Bun.main) : realpathSync(fileURLToPath(new URL("../", import.meta.url)));
export const packageAsset = (...path: string[]) => join(packageRoot(), ...path);
export const distAsset = (...path: string[]) => standalone ? packageAsset(...path) : packageAsset("dist", ...path);
export const cliArgv = (command: string, bunPath: string, root: string) =>
  standalone ? [bunPath, command] : [bunPath, join(root, "dist", "cli", "main.js"), command];
export function hookCommand(bunPath: string, root: string, runtime: string): string {
  const quote = (arg: string) => '"' + arg.replace(/["`\\$]/g, "\\$&") + '"';
  return [quote(bunPath), standalone ? "hook-post" : quote(join(root, "packs", "hook-post.mjs")), runtime].join(" ");
}
export const isHookCommand = (command: string) => /(?:hook-post\.mjs"| hook-post) [\w-]+$/.test(command);

export function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(packageAsset("package.json"), "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest) || typeof manifest.version !== "string") {
    throw new TypeError("Invalid skillar package version");
  }
  return manifest.version;
}
