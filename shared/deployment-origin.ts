import { z } from "zod";

export const deploymentOriginSchema = z.url().refine(value => {
  const url = new URL(value);
  return value === url.origin && (url.protocol === "https:" ||
    value === "http://localhost:8788");
});

export interface DeploymentOrigins {
  readonly PUBLIC_ORIGIN?: string | undefined;
  readonly PUBLIC_ORIGIN_ALIAS?: string | undefined;
}

export function isDeploymentOrigin(origin: string, env: DeploymentOrigins): boolean {
  return origin === (env.PUBLIC_ORIGIN ?? "https://skillar.sh") ||
    origin === env.PUBLIC_ORIGIN_ALIAS;
}
