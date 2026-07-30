import { routeRequest } from "./router"

export default {
  async fetch(request, env) {
    return await routeRequest(request, {
      assets: env.ASSETS,
    })
  },
} satisfies ExportedHandler<Env>
