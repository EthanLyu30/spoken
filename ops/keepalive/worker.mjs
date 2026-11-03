import { checkBackend, DEFAULT_HEALTH_URL } from "./check.mjs";

export default {
  async scheduled(_controller, env) {
    // Await the result so exhausted retries mark the Cron invocation as failed.
    await checkBackend(env.BACKEND_HEALTH_URL || DEFAULT_HEALTH_URL);
  },
};
