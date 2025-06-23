/**
 * Tenant Entry Point using Module Pattern
 * Exports tenant identifier and main plugin function
 */
export const TENANT_ID = "sample-tenant";

/**
 * Main tenant plugin function
 * Follows Fastify plugin conventions
 */
export default async function tenantPlugin(fastify, options) {
  const { tenant, config } = options;

  fastify.log.info(`Loading tenant: ${tenant}`);

  // Register tenant-specific context
  fastify.decorate("tenantContext", {
    id: tenant,
    config: config,
    data: new Map(), // Simple in-memory storage
  });

  // Add tenant identification to all responses
  fastify.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Tenant-ID", tenant);
    return payload;
  });
}
