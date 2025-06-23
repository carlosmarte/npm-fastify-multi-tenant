/**
 * Main Tenant Routes using Router Pattern
 */
export default async function routes(fastify, options) {
  const { tenant } = options;

  // Tenant info endpoint
  fastify.get("/", async (request, reply) => {
    return {
      success: true,
      tenant: tenant,
      timestamp: new Date().toISOString(),
      status: "active",
    };
  });

  // Tenant status endpoint
  fastify.get("/status", async (request, reply) => {
    const context = fastify.tenantContext;

    return {
      success: true,
      data: {
        id: context.id,
        dataCount: context.data.size,
        config: context.config.features,
      },
    };
  });
}
