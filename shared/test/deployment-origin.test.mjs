import assert from "node:assert/strict";
import test from "node:test";
import { deploymentOriginSchema, isDeploymentOrigin } from "../deployment-origin.ts";

test("deployment configuration accepts exact HTTPS origins but not URL credentials or paths", () => {
  // Given / When / Then
  assert.equal(deploymentOriginSchema.parse("https://self-host.example.test"), "https://self-host.example.test");
  for (const value of ["http://remote.example.test", "https://user:pass@example.test",
    "https://example.test/", "https://example.test/path", "https://example.test?q=x",
    "https://example.test#fragment"]) {
    assert.equal(deploymentOriginSchema.safeParse(value).success, false);
  }
});

test("only the configured primary and exact alias authenticate, without wildcard preview access", () => {
  // Given
  const env = { PUBLIC_ORIGIN: "https://self-host.example.test", PUBLIC_ORIGIN_ALIAS: "https://alias.example.test" };
  // When / Then
  assert.equal(isDeploymentOrigin(env.PUBLIC_ORIGIN, env), true);
  assert.equal(isDeploymentOrigin(env.PUBLIC_ORIGIN_ALIAS, env), true);
  assert.equal(isDeploymentOrigin("https://preview.alias.example.test", env), false);
  assert.equal(isDeploymentOrigin("https://skillar.sh", env), false);
  assert.equal(isDeploymentOrigin("https://skillar.sh", {}), true);
  assert.equal(isDeploymentOrigin(env.PUBLIC_ORIGIN_ALIAS, {}), false);
});
