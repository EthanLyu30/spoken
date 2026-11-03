import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const options = { attempts: 3, timeoutMs: 1_000, retryDelayMs: 0 };

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/health`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("accepts a healthy response without retrying", async () => {
  const { checkBackend } = await import("./check.mjs");
  let calls = 0;
  await withServer((req, res) => {
    calls++;
    assert.equal(req.url, "/api/health");
    res.end('{"status":"ok","app":"Spoken"}');
  }, async (url) => {
    await checkBackend(url, options);
    assert.equal(calls, 1);
  });
});

test("retries a temporary server error and recovers", async () => {
  const { checkBackend } = await import("./check.mjs");
  let calls = 0;
  await withServer((_req, res) => {
    if (++calls === 1) {
      res.writeHead(503);
      res.end("Starting up");
    } else {
      res.end('{"status":"ok"}');
    }
  }, async (url) => {
    await checkBackend(url, options);
    assert.equal(calls, 2);
  });
});

test("times out a stalled response body and retries", async () => {
  const { checkBackend } = await import("./check.mjs");
  let calls = 0;
  await withServer((_req, res) => {
    if (++calls === 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();
    } else {
      res.end('{"status":"ok"}');
    }
  }, async (url) => {
    await checkBackend(url, { ...options, timeoutMs: 100 });
    assert.equal(calls, 2);
  });
});

for (const [name, status, body] of [
  ["HTTP errors", 503, "Unavailable"],
  ["HTML loading pages", 200, "<html>Starting up</html>"],
  ["unhealthy JSON", 200, '{"status":"error"}'],
  ["empty JSON", 200, "null"],
]) {
  test(`fails after all retries for ${name}`, async () => {
    const { checkBackend } = await import("./check.mjs");
    let calls = 0;
    await withServer((_req, res) => {
      calls++;
      res.writeHead(status);
      res.end(body);
    }, async (url) => {
      await assert.rejects(checkBackend(url, options), /failed after 3 attempts/);
      assert.equal(calls, 3);
    });
  });
}

test("CLI exits nonzero when the configured backend is unreachable", () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("./cli.mjs", import.meta.url)),
  ], {
    env: { ...process.env, BACKEND_HEALTH_URL: "invalid-url" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Backend health check failed/);
});

test("CLI uses the configured backend and exits successfully when healthy", async () => {
  await withServer((_req, res) => res.end('{"status":"ok"}'), async (url) => {
    const result = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("./cli.mjs", import.meta.url)),
    ], {
      env: { ...process.env, BACKEND_HEALTH_URL: url },
      timeout: 5_000,
    });
    assert.match(result.stdout, /Backend healthy/);
  });
});

test("Worker awaits the health check using its configured backend", async () => {
  const { default: worker } = await import("./worker.mjs");
  let calls = 0;
  await withServer((_req, res) => {
    calls++;
    res.end('{"status":"ok"}');
  }, async (url) => {
    await worker.scheduled({}, { BACKEND_HEALTH_URL: url });
    assert.equal(calls, 1);
  });
});

test("Worker propagates a health check failure to the scheduler", async () => {
  const { default: worker } = await import("./worker.mjs");
  await assert.rejects(worker.scheduled({}, {
    BACKEND_HEALTH_URL: "invalid-url",
  }));
});
