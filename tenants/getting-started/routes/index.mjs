async function gettingStartedFastifyPlugin(fastify, options) {
  fastify.get("/", async (request, reply) => {
    return "hello";
  });
}

export default gettingStartedFastifyPlugin;
