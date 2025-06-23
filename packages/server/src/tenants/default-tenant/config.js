/**
 * Tenant Configuration using Configuration Object pattern
 */
export default {
  name: "sample-tenant",
  active: true,
  database: {
    // Simple in-memory storage for demo
    type: "memory",
  },
  features: {
    userManagement: true,
    analytics: true,
    auditLogging: true,
  },
  limits: {
    maxUsers: 1000,
    requestsPerMinute: 100,
  },
};
