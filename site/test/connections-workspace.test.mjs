import assert from "node:assert/strict";
import test from "node:test";
import { loadViews } from "./helpers/t10-dom.mjs";

const { connectionRows } = await loadViews('export { connectionRows } from "./site/src/connections-workspace.ts";');
const now = 1793870000;
const mcp = { connectionId: "test", name: "test", kind: "pat", createdAt: now - 10, expiresAt: now + 10,
  revokedAt: null, scopes: ["skills:read"], recordActivity: false };
const device = { deviceId: "test", createdAt: now - 20, revokedAt: null, version: 1, consent: { mode: "local-only" } };

test("device and MCP identifiers cannot collide in a combined connection table", () => {
  // Given
  const model = { connections: [mcp] };
  // When
  const rows = connectionRows(model, [device], now);
  // Then
  assert.equal(new Set(rows.map(row => row.id)).size, 2);
  assert.equal(rows[0].device, device);
  assert.equal(rows[1].mcp, mcp);
});

test("combined connection status uses expiry and revocation without inventing online state", () => {
  // Given
  const connections = [mcp, { ...mcp, connectionId: "expired", expiresAt: now },
    { ...mcp, connectionId: "revoked", revokedAt: now - 1 }];
  // When
  const rows = connectionRows({ connections }, [{ ...device, revokedAt: now - 1 }], now);
  // Then
  assert.equal(rows[0].status, rows[3].status);
  assert.notEqual(rows[1].status, rows[2].status);
  assert.notEqual(rows[2].status, rows[3].status);
  assert.equal(rows[2].created, mcp.createdAt);
});
