/**
 * User Schemas using Schema Registry Pattern
 */

export const userIdParam = {
  $id: "userIdParam",
  type: "object",
  properties: {
    id: { type: "string", pattern: "^[a-zA-Z0-9-_]+$" },
  },
  required: ["id"],
};

export const createUserRequest = {
  $id: "createUserRequest",
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    email: { type: "string", format: "email" },
    role: { type: "string", enum: ["user", "admin"] },
  },
  required: ["name", "email"],
  additionalProperties: false,
};

export const userResponse = {
  $id: "userResponse",
  type: "object",
  properties: {
    success: { type: "boolean" },
    data: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        role: { type: "string" },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
      },
    },
  },
};

export const userListResponse = {
  $id: "userListResponse",
  type: "object",
  properties: {
    success: { type: "boolean" },
    data: {
      type: "array",
      items: { $ref: "userResponse#/properties/data" },
    },
    count: { type: "number" },
  },
};

// Export all schemas for auto-registration
export default [userIdParam, createUserRequest, userResponse, userListResponse];
