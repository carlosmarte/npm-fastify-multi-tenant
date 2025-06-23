// test/server.test.mjs
import { test } from "node:test";
import { MultiTenantServer } from "./index.mjs";

test("should start server successfully", async (t) => {
  const server = new MultiTenantServer({
    server: { port: 0 }, // Use random port for testing
  });

  const app = await server.start();
  t.assert(app.server.listening);

  await server.stop();
});

test("should load tenant correctly", async (t) => {
  const server = new MultiTenantServer();
  await server.start();

  const tenant = await server.initTenant("test-tenant");
  t.assert(tenant.id === "test-tenant");
  t.assert(tenant.active === true);

  await server.stop();
});
