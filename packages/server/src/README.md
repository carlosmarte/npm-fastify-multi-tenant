Project Structure

```
/
├── main.mjs               # Main entry point (this file)
├── src/
│   ├── plugins/           # Core plugins
│   │   ├── exception/     # Error handling
│   │   ├── logger/        # Logging configuration
│   │   └── ...
│   └── tenants/           # Tenant-specific code
│       ├── tenant1/       # First tenant
│       │   ├── config.js  # Tenant configuration
│       │   ├── index.mjs  # Optional custom tenant name
│       │   ├── plugins/   # Tenant-specific plugins
│       │   ├── routes/    # Tenant-specific routes
│       │   ├── schemas/   # JSON schemas
│       │   └── services/  # Business logic
│       └── tenant2/       # Second tenant
└── package.json
```

```js
import { MultiTenantServer } from "./main.mjs";

const server = new MultiTenantServer({
  server: { port: 3000 },
  security: { maxConcurrentTenants: 100 },
});

await server.start();
```

```js
import { TenantIdentificationStrategy } from "./main.mjs";

class HeaderBasedStrategy extends TenantIdentificationStrategy {
  extractTenantId(request) {
    return request.headers["x-custom-tenant"] || "default";
  }
}

server.tenantManager.setIdentificationStrategy(new HeaderBasedStrategy());
```

```js
import { MultiTenantServer, ConfigurationManager } from "./main.mjs";

// Custom configuration
const config = new ConfigurationManager({
  security: {
    maxConcurrentTenants: 100,
    validateInputs: true,
  },
  plugins: {
    coreOrder: ["database", "auth", "logger"],
    npmPattern: "my-company-plugin-*",
  },
});

const server = new MultiTenantServer(config.get());
await server.start();
```

```js
import { PluginLoadingStrategy, MultiTenantServer } from "./main.mjs";

class S3PluginStrategy extends PluginLoadingStrategy {
  async loadPlugin(app, s3Key, options = {}) {
    // Load plugin from S3
    const pluginCode = await this.downloadFromS3(s3Key);
    const plugin = eval(pluginCode);
    await app.register(plugin, options);
    return plugin;
  }
}

const server = new MultiTenantServer();
server.pluginManager.addStrategy("s3", new S3PluginStrategy());
```

```js
import { TenantIdentificationStrategy, MultiTenantServer } from "./main.mjs";

class JWTTenantStrategy extends TenantIdentificationStrategy {
  extractTenantId(request) {
    const token = request.headers.authorization?.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.tenantId;
  }
}

const server = new MultiTenantServer();
server.tenantManager.setIdentificationStrategy(new JWTTenantStrategy());
```

```js
const server = new MultiTenantServer();
await server.start();

// Load a specific tenant
const tenant = await server.initTenant("customer-123");
console.log("Loaded services:", tenant.listServices());

// Get tenant statistics
const stats = await server.getTenantStats();
console.log(`Active tenants: ${stats.active}/${stats.total}`);

// Reload tenant configuration
await server.reloadTenant("customer-123");
```

```js
// tenants/customer-123/services/UserService.mjs
export default class UserService {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  async getUser(id) {
    return await this.db.users.findById(id);
  }

  async createUser(userData) {
    return await this.db.users.create({
      ...userData,
      tenantId: this.config.id,
    });
  }
}
```

```js
// tenants/customer-123/routes/index.mjs
export default async function (fastify, options) {
  const { tenant, config } = options;

  fastify.get("/users", async (request, reply) => {
    const userService = request.tenant.getService("UserService");
    const users = await userService.getAllUsers();
    return { success: true, data: users };
  });

  fastify.post("/users", async (request, reply) => {
    const userService = request.tenant.getService("UserService");
    const user = await userService.createUser(request.body);
    return { success: true, data: user };
  });
}
```

```js
const server = new MultiTenantServer();

// Custom error handling
server.app.setErrorHandler(async (error, request, reply) => {
  const tenantId = request.tenantId;

  request.log.error(
    {
      err: error,
      tenant: tenantId,
    },
    "Tenant-specific error"
  );

  // Tenant-specific error responses
  const tenant = request.tenant;
  if (tenant?.config?.customErrors) {
    return reply.code(500).send({
      success: false,
      error: tenant.config.errorMessages[error.code] || "Unknown error",
    });
  }

  // Default error response
  return reply.code(500).send({
    success: false,
    error: "Internal server error",
  });
});
```

```js
// test/server.test.mjs
import { test } from "node:test";
import { MultiTenantServer } from "../main.mjs";

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
```

```js
// server.mjs
import { MultiTenantServer } from "./main.mjs";

const server = new MultiTenantServer({
  server: { port: 3000 },
  tenants: {
    maxConcurrent: 100,
    npmPattern: "fastify-multitenant-*",
  },
  plugins: {
    coreOrder: ["database", "auth", "logger"],
  },
});

await server.start();
```
