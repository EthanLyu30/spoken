export const DEFAULT_HEALTH_URL = "https://spoken-backend-sg.onrender.com/api/ready";

// Share the same health contract and cold-start allowance between Workers and CI.
export async function checkBackend(url, {
  attempts = 3,
  timeoutMs = 75_000,
  retryDelayMs = 5_000,
} = {}) {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("The backend health URL must use HTTP or HTTPS");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(target, {
        signal: controller.signal,
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        cache: "no-store",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      // A Render loading page can return 200 before the application is ready.
      const body = await response.json();
      if (body?.status !== "ok") throw new Error("Unhealthy backend response");
      console.log(`Backend healthy (${Date.now() - started}ms, attempt ${attempt})`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Health probe ${attempt}/${attempts} failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`Backend health check failed after ${attempts} attempts`, {
    cause: lastError,
  });
}
