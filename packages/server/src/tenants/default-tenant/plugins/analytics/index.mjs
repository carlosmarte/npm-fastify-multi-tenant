/**
 * Analytics Plugin using Plugin Pattern
 * Demonstrates tenant-specific functionality
 */

export default async function analyticsPlugin(fastify, options) {
  const { tenant } = options;

  // Simple analytics store
  const analytics = {
    requests: new Map(),
    errors: new Map(),
    startTime: Date.now(),
  };

  // Decorate fastify with analytics
  fastify.decorate("analytics", analytics);

  // Track requests
  fastify.addHook("onRequest", async (request, reply) => {
    const route = request.routerPath || request.url;
    const current = analytics.requests.get(route) || 0;
    analytics.requests.set(route, current + 1);
  });

  // Track errors
  fastify.addHook("onError", async (request, reply, error) => {
    const route = request.routerPath || request.url;
    const current = analytics.errors.get(route) || 0;
    analytics.errors.set(route, current + 1);
  });

  // Analytics endpoint
  fastify.get("/analytics", async (request, reply) => {
    const uptime = Date.now() - analytics.startTime;

    return {
      success: true,
      data: {
        tenant,
        uptime: `${Math.round(uptime / 1000)}s`,
        requests: Object.fromEntries(analytics.requests),
        errors: Object.fromEntries(analytics.errors),
        totalRequests: Array.from(analytics.requests.values()).reduce(
          (a, b) => a + b,
          0
        ),
        totalErrors: Array.from(analytics.errors.values()).reduce(
          (a, b) => a + b,
          0
        ),
      },
    };
  });
}
