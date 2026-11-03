import { checkBackend, DEFAULT_HEALTH_URL } from "./check.mjs";

try {
  await checkBackend(process.env.BACKEND_HEALTH_URL || DEFAULT_HEALTH_URL);
} catch (error) {
  console.error(`Backend health check failed: ${error.message}`);
  process.exitCode = 1;
}
