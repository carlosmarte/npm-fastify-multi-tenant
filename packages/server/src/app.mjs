import { MultiTenantServer } from "./index.mjs";

const server = new MultiTenantServer({
  server: { port: 3000 },
  security: { maxConcurrentTenants: 100 },
});

await server.start();
