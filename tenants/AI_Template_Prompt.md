System Architect Tenant Creation Guide
Target Audience: Backend developers, system architects, DevOps engineers
Complexity Level: Advanced
Prerequisites: NodeJS, Fastify, Design Patterns knowledge

# 📋 Pre-Creation Checklist

Tenant ID validated (alphanumeric, hyphens, underscores only)
Business requirements documented
Database schema requirements identified
API endpoints specification ready
Security requirements defined
Performance requirements established

🏛️ Architecture Decision Template

## Tenant: [TENANT_NAME]

### Business Context

- **Purpose**: [What business function does this tenant serve?]
- **Users**: [Who will use this tenant?]
- **Scale**: [Expected load, concurrent users, data volume]

### Technical Decisions

- **Data Storage**: [Memory/Database/External API]
- **Authentication**: [Required auth method]
- **Rate Limiting**: [Requests per minute/hour]
- **Dependencies**: [External services, other tenants]

### Patterns Applied

- [ ] Repository Pattern (for data access)
- [ ] Service Layer (for business logic)
- [ ] Factory Pattern (for object creation)
- [ ] Strategy Pattern (for configurable behavior)
- [ ] Plugin Pattern (for extensibility)

# 📁 File Generation Instructions

Step 1: Core Structure Setup

```sh
mkdir -p tenants/[TENANT_ID]/{routes,services,schemas,lib,plugins,config}
cd tenants/[TENANT_ID]
```

Step 2: Configuration File (config.js)

```js
// Template: Adapt based on business requirements
export default {
  name: "[TENANT_NAME]",
  active: true,
  database: {
    type: "[memory|postgresql|mongodb|redis]",
    // Add connection details if needed
  },
  features: {
    // Enable/disable tenant features
    userManagement: [true | false],
    analytics: [true | false],
    auditLogging: [true | false],
    fileUpload: [true | false],
    notifications: [true | false],
  },
  limits: {
    maxUsers: [NUMBER],
    requestsPerMinute: [NUMBER],
    storageQuotaMB: [NUMBER],
  },
  security: {
    requireAuth: [true | false],
    allowedOrigins: ["[CORS_ORIGINS]"],
    rateLimiting: [true | false],
  },
  integrations: {
    // External service configurations
  },
};
```

Step 3: Main Entry Point (index.mjs)

```js
// Template: Standard tenant plugin structure
export const TENANT_ID = "[TENANT_ID]";

export default async function tenantPlugin(fastify, options) {
  const { tenant, config } = options;

  // 1. Initialize data store based on config
  const dataStore = createDataStore(config.database.type);

  // 2. Register tenant context
  fastify.decorate("tenantContext", {
    id: tenant,
    config: config,
    data: dataStore,
    services: {},
  });

  // 3. Initialize services using Factory pattern
  await initializeServices(fastify, config);

  // 4. Add tenant middleware
  fastify.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Tenant-ID", tenant);
    return payload;
  });

  // 5. Register error handling
  fastify.setErrorHandler(tenantErrorHandler);
}

// Factory function for data store creation
function createDataStore(type) {
  switch (type) {
    case "memory":
      return new Map();
    case "postgresql":
      return createPgConnection();
    case "mongodb":
      return createMongoConnection();
    default:
      return new Map();
  }
}

// Service initialization using Dependency Injection
async function initializeServices(fastify, config) {
  // Initialize services based on enabled features
  if (config.features.userManagement) {
    const { default: createUserService } = await import(
      "./services/userService.mjs"
    );
    fastify.tenantContext.services.UserService = createUserService(
      fastify.tenantContext.data,
      config
    );
  }

  // Add more services as needed
}

function tenantErrorHandler(error, request, reply) {
  request.log.error({ err: error, tenant: request.tenant?.id }, "Tenant error");

  const isDev = process.env.NODE_ENV === "development";
  reply.code(error.statusCode || 500).send({
    success: false,
    error: isDev ? error.message : "Internal server error",
    tenant: request.tenant?.id,
  });
}
```

Step 4: Service Layer Generation
For each domain entity, create:

```js
// services/[ENTITY]Service.mjs
// Follow the Repository + Service + Validator pattern

export class [ENTITY]Service {
  constructor(repository, config = {}) {
    this.repository = repository;
    this.config = config;
    this.validator = new [ENTITY]Validator();
  }

  // CRUD operations with business logic
  async getAll(filters = {}) {
    this.validator.validateFilters(filters);
    return await this.repository.findAll(filters);
  }

  async getById(id) {
    this.validator.validateId(id);
    return await this.repository.findById(id);
  }

  async create(data) {
    // 1. Validate input
    this.validator.validateCreateData(data);

    // 2. Apply business rules
    await this.applyBusinessRules(data);

    // 3. Enrich data
    const enrichedData = this.enrichCreateData(data);

    // 4. Persist
    return await this.repository.create(enrichedData);
  }

  // Implement other methods...

  private async applyBusinessRules(data) {
    // Implement business validation
  }

  private enrichCreateData(data) {
    return {
      ...data,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}

export class [ENTITY]Repository {
  constructor(dataStore) {
    this.store = dataStore;
  }

  // Data access methods
}

export class [ENTITY]Validator {
  // Validation methods
}

// Factory function
export default function create[ENTITY]Service(dataStore, config = {}) {
  const repository = new [ENTITY]Repository(dataStore);
  return new [ENTITY]Service(repository, config);
}
```

Step 5: Route Controller Generation

```js
// routes/[ENTITY].mjs
// RESTful API controller following OpenAPI standards

export default async function [ENTITY]Routes(fastify, options) {
  const { tenant } = options;

  // Get service dependency
  const getService = () => {
    const service = fastify.tenantContext.services?.[ENTITY]Service;
    if (!service) {
      throw new Error(`${[ENTITY]}Service not available`);
    }
    return service;
  };

  // GET /[entities] - List with pagination and filtering
  fastify.get('/[entities]', {
    schema: {
      querystring: { $ref: '[entity]ListQuery#' },
      response: { 200: { $ref: '[entity]ListResponse#' } }
    }
  }, async (request, reply) => {
    try {
      const service = getService();
      const { page = 1, limit = 10, ...filters } = request.query;

      const result = await service.getAll({
        ...filters,
        pagination: { page, limit }
      });

      return {
        success: true,
        data: result.items,
        pagination: result.pagination
      };
    } catch (error) {
      return handleControllerError(error, request, reply);
    }
  });

  // Implement other CRUD endpoints...
}

function handleControllerError(error, request, reply) {
  request.log.error({ error }, 'Controller error');

  if (error.name === 'ValidationError') {
    return reply.code(400).send({
      success: false,
      error: error.message,
      field: error.field
    });
  }

  return reply.code(500).send({
    success: false,
    error: 'Internal server error'
  });
}
```

Step 6: Schema Definition

```js
// schemas/[entity].mjs
// JSON Schema definitions for validation and documentation

export const [entity]CreateRequest = {
  $id: '[entity]CreateRequest',
  type: 'object',
  properties: {
    // Define properties based on business requirements
  },
  required: ['requiredField1', 'requiredField2'],
  additionalProperties: false
};

// Define all schemas...

export default [
  [entity]CreateRequest,
  [entity]UpdateRequest,
  [entity]Response,
  [entity]ListResponse,
  [entity]ListQuery
];
```

🧪 Testing Template

```js
// tests/[ENTITY].test.mjs
import { test } from "tap";
import { build } from "../helper.mjs";

test("[ENTITY] Service Tests", async (t) => {
  const app = await build(t);

  t.test("should create [entity]", async (t) => {
    // Test implementation
  });

  t.test("should validate input", async (t) => {
    // Test validation
  });

  // More tests...
});
```

🔍 Quality Assurance Checklist
Architecture Review

- [ ] Single Responsibility Principle applied to each class
- [ ] Dependencies injected, not hard-coded
- [ ] Repository pattern used for data access
- [ ] Service layer contains business logic only
- [ ] Controllers handle HTTP concerns only

Security Review

- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (if using SQL)
- [ ] XSS prevention in responses
- [ ] Rate limiting configured
- [ ] Authentication/authorization implemented

Performance Review

- [ ] Database queries optimized
- [ ] Caching strategy implemented
- [ ] Memory leaks checked
- [ ] Load testing completed

Maintainability Review

- [ ] Code documented with JSDoc
- [ ] Error messages are descriptive
- [ ] Configuration externalized
- [ ] Logging implemented consistently

🚀 Deployment Checklist

- [ ] Environment variables configured
- [ ] Database migrations ready (if applicable)
- [ ] Health checks implemented
- [ ] Monitoring configured
- [ ] Documentation updated

### **Pattern Reference Quick Guide**

```md
| Pattern           | Use Case                | Implementation                     |
| ----------------- | ----------------------- | ---------------------------------- |
| **Repository**    | Data access abstraction | `[Entity]Repository` class         |
| **Service Layer** | Business logic          | `[Entity]Service` class            |
| **Factory**       | Object creation         | `create[Entity]Service()` function |
| **Validator**     | Input validation        | `[Entity]Validator` class          |
| **Plugin**        | Feature modularity      | Fastify plugin structure           |
| **Decorator**     | Extending functionality | `fastify.decorate()`               |
```

👤 user.md - Business User Tenant Creation Template
Non-Technical Tenant Creation Guide
Target Audience: Business analysts, product managers, non-technical stakeholders
Complexity Level: Beginner
Prerequisites: Basic understanding of web applications

🎯 Tenant Planning Worksheet
Fill out this worksheet before creating your tenant:

```md
## Tenant Information

**Tenant Name**: **\*\***\_\_\_\_**\*\***
**Purpose**: What will this tenant do?

---

**Users**: Who will use this tenant?

- [ ] Internal employees
- [ ] External customers
- [ ] Partners
- [ ] Administrators only

**Features Needed**:

- [ ] User registration and login
- [ ] File upload/download
- [ ] Email notifications
- [ ] Reports and analytics
- [ ] Data export
- [ ] Mobile app support

**Data Requirements**:

- [ ] User profiles
- [ ] Documents/files
- [ ] Transaction records
- [ ] Analytics data
- [ ] Configuration settings

**Integration Needs**:

- [ ] Email system
- [ ] Payment processing
- [ ] External databases
- [ ] Third-party APIs
- [ ] Single sign-on (SSO)

**Volume Expectations**:

- Expected number of users: **\_\_\_\_**
- Peak usage time: **\_\_\_\_**
- Data storage needs: **\_\_\_\_** GB/TB
```

📝 Simple Configuration Template
Create a file called config.js with your tenant settings:

```js
// Copy this template and fill in your values
export default {
  // Basic Information
  name: "YOUR_TENANT_NAME_HERE", // e.g., "customer-portal"
  active: true, // Set to false to disable

  // Features (set to true for features you need)
  features: {
    userManagement: true, // User registration, login, profiles
    analytics: false, // Usage reports and statistics
    auditLogging: true, // Track user actions
    fileUpload: false, // Allow file uploads
    notifications: true, // Send email/SMS notifications
    apiAccess: false, // Provide API endpoints
  },

  // Limits (adjust based on your needs)
  limits: {
    maxUsers: 1000, // Maximum number of users
    requestsPerMinute: 100, // API calls per minute per user
    storageQuotaMB: 5000, // Total file storage in MB (5GB)
  },

  // Security Settings
  security: {
    requireAuth: true, // Users must log in
    rateLimiting: true, // Prevent abuse
    allowedOrigins: [
      // Websites that can access your tenant
      "https://yourcompany.com",
      "https://app.yourcompany.com",
    ],
  },
};
```

🗂️ File Structure Creation Guide
Step 1: Create Your Tenant Folder

```md
tenants/
└── your-tenant-name/ ← Create this folder
├── config.js ← Your configuration (required)
├── index.mjs ← Main file (we'll help create this)
├── routes/ ← Web pages/API endpoints
├── services/ ← Business logic
└── schemas/ ← Data validation rules
```

Step 2: Basic Files You Need

config.js - Use the template above
index.mjs - Copy this basic template:

```js
// Basic tenant setup - copy this template
export const TENANT_ID = "your-tenant-name";

export default async function tenantPlugin(fastify, options) {
  const { tenant, config } = options;

  // Basic setup
  fastify.log.info(`Starting tenant: ${tenant}`);

  // Add tenant info to all responses
  fastify.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Tenant-ID", tenant);
    return payload;
  });

  // Simple data storage (in memory)
  fastify.decorate("tenantData", new Map());

  // Basic health check
  fastify.get("/", async (request, reply) => {
    return {
      success: true,
      tenant: tenant,
      status: "running",
      timestamp: new Date().toISOString(),
    };
  });
}
```

🔧 Feature-Based Templates
If you need User Management:
Create routes/users.mjs:

```js
export default async function userRoutes(fastify, options) {
  // Get all users
  fastify.get("/users", async (request, reply) => {
    const users = Array.from(fastify.tenantData.values()).filter(
      (item) => item.type === "user"
    );

    return {
      success: true,
      data: users,
      count: users.length,
    };
  });

  // Create new user
  fastify.post("/users", async (request, reply) => {
    const { name, email } = request.body;

    // Simple validation
    if (!name || !email) {
      return reply.code(400).send({
        success: false,
        error: "Name and email are required",
      });
    }

    const user = {
      id: Date.now().toString(),
      type: "user",
      name,
      email,
      createdAt: new Date().toISOString(),
    };

    fastify.tenantData.set(user.id, user);

    return {
      success: true,
      data: user,
    };
  });
}
```

If you need File Upload:
Create plugins/fileUpload/index.mjs:

```js
export default async function fileUploadPlugin(fastify, options) {
  // Register multipart support
  await fastify.register(import("@fastify/multipart"));

  fastify.post("/upload", async function (request, reply) {
    const data = await request.file();

    if (!data) {
      return reply.code(400).send({
        success: false,
        error: "No file uploaded",
      });
    }

    // Simple file info storage
    const fileInfo = {
      id: Date.now().toString(),
      type: "file",
      filename: data.filename,
      mimetype: data.mimetype,
      uploadedAt: new Date().toISOString(),
    };

    fastify.tenantData.set(fileInfo.id, fileInfo);

    return {
      success: true,
      data: fileInfo,
    };
  });
}
```

### 🚨 **Common Issues & Solutions**

```md
| Issue                   | Likely Cause             | Solution                                  |
| ----------------------- | ------------------------ | ----------------------------------------- |
| "Tenant not found"      | Wrong URL or tenant name | Check spelling, use hyphens not spaces    |
| "Plugin failed to load" | Syntax error in files    | Ask developer to check logs               |
| "Route not found"       | Missing route file       | Create the route file in `routes/` folder |
| "Validation error"      | Missing required fields  | Check what fields are required            |
```

🎉 Success Checklist
Your tenant is ready when:

- [ ] Configuration file is complete
- [ ] Tenant loads without errors
- [ ] Health check endpoint responds
- [ ] Required features work as expected
- [ ] Testing completed successfully
- [ ] Documentation updated
