/**
 * User Routes using Controller Pattern
 */
export default async function userRoutes(fastify, options) {
  const { tenant } = options;

  // Get user service
  const getUserService = () => {
    const UserService = fastify.tenantContext.services?.UserService;
    if (!UserService) {
      throw new Error("UserService not available");
    }
    return UserService;
  };

  // List users
  fastify.get(
    "/users",
    {
      schema: {
        response: {
          200: { $ref: "userListResponse#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const userService = getUserService();
        const users = await userService.getAll();

        return {
          success: true,
          data: users,
          count: users.length,
        };
      } catch (error) {
        request.log.error({ error }, "Failed to fetch users");
        reply.code(500).send({
          success: false,
          error: "Failed to fetch users",
        });
      }
    }
  );

  // Create user
  fastify.post(
    "/users",
    {
      schema: {
        body: { $ref: "createUserRequest#" },
        response: {
          201: { $ref: "userResponse#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const userService = getUserService();
        const user = await userService.create(request.body);

        reply.code(201);
        return {
          success: true,
          data: user,
        };
      } catch (error) {
        request.log.error({ error }, "Failed to create user");
        reply.code(400).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  // Get user by ID
  fastify.get(
    "/users/:id",
    {
      schema: {
        params: { $ref: "userIdParam#" },
        response: {
          200: { $ref: "userResponse#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const userService = getUserService();
        const user = await userService.getById(request.params.id);

        if (!user) {
          return reply.code(404).send({
            success: false,
            error: "User not found",
          });
        }

        return {
          success: true,
          data: user,
        };
      } catch (error) {
        request.log.error({ error }, "Failed to fetch user");
        reply.code(500).send({
          success: false,
          error: "Failed to fetch user",
        });
      }
    }
  );
}
