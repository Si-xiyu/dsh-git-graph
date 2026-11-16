/**
 * Trust fence on the HTTP routes.
 *
 * `ctx.webServer.register` gives a route a raw `node:http` handler and applies
 * no Host/Origin or browser-authentication policy, so the plugin has to run
 * Connection's fence (`requestRejection`) itself. These tests drive the
 * registered handler over real HTTP with a stub Connection and assert that the
 * fence runs first, refuses before any `git` runs, and fails closed.
 *
 * Run with: node --test test/host-trust.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, createTrustGate } from "../lib/index.js";

const exec = promisify(execFile);
let repo;
const git = async (...args) => (await exec("git", args, { cwd: repo })).stdout.trim();

/**
 * Boot the plugin against a stub webServer and serve the registered route.
 * `connection` is whatever the composition would supply — including nothing.
 */
async function boot(connection) {
  let handler;
  apply({
    effect: (fn) => fn(),
    webServer: {
      register(route) {
        handler = route.handler;
        return () => {};
      },
    },
    connection,
  });
  assert.ok(handler, "apply() must register a handler");
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/vsc-git-graph` };
}

const stop = async (server) => {
  if (server) await new Promise((resolve) => server.close(resolve));
};

/** Send one request and return its status and parsed JSON body. */
async function call(url, init = {}) {
  const res = await fetch(url, { method: "POST", body: JSON.stringify({ op: "status", path: repo }), ...init });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

before(async () => {
  repo = await mkdtemp(join(tmpdir(), "host-trust-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "测试作者");
  await git("config", "user.email", "test@example.com");
  await writeFile(join(repo, "a.txt"), "hello\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "initial");
});

after(async () => {
  if (repo) await rm(repo, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

// ── the fence itself ──────────────────────────────────────────────────────

test("createTrustGate forwards Connection's rejection status", () => {
  assert.equal(createTrustGate({ requestRejection: () => 401 })({}), 401);
  assert.equal(createTrustGate({ requestRejection: () => 403 })({}), 403);
  assert.equal(createTrustGate({ requestRejection: () => undefined })({}), undefined);
});

test("createTrustGate fails closed without a Connection handle", () => {
  for (const absent of [undefined, null, {}, { requestRejection: "not a function" }]) {
    assert.equal(createTrustGate(absent)({}), 503, "a route with no trust fence must not be reachable");
  }
});

// ── over HTTP ─────────────────────────────────────────────────────────────

test("a 401 from the fence is answered as 401 and never reaches git", async () => {
  const { server, url } = await boot({ requestRejection: () => 401 });
  try {
    const { status, body } = await call(url);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "forbidden");
  } finally {
    await stop(server);
  }
});

test("a 403 from the fence is answered as 403", async () => {
  const { server, url } = await boot({ requestRejection: () => 403 });
  try {
    assert.equal((await call(url)).status, 403);
  } finally {
    await stop(server);
  }
});

test("the fence runs before the method check", async () => {
  const refusing = await boot({ requestRejection: () => 403 });
  const admitting = await boot({ requestRejection: () => undefined });
  try {
    // A rejected GET is a 403, not the handler's own 405.
    assert.equal((await call(refusing.url, { method: "GET", body: undefined })).status, 403);
    // An admitted GET still reaches the handler's method check.
    assert.equal((await call(admitting.url, { method: "GET", body: undefined })).status, 405);
  } finally {
    await stop(refusing.server);
    await stop(admitting.server);
  }
});

test("the fence runs before the JSON body is parsed", async () => {
  const { server, url } = await boot({ requestRejection: () => 401 });
  try {
    // An unknown op would answer 400 bad-op if the handler had seen the body.
    const res = await fetch(url, { method: "POST", body: JSON.stringify({ op: "no-such-op", path: repo }) });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, "forbidden");
  } finally {
    await stop(server);
  }
});

test("a composition without Connection serves 503, not an open route", async () => {
  const { server, url } = await boot(undefined);
  try {
    const { status, body } = await call(url);
    assert.equal(status, 503);
    assert.equal(body.error.code, "forbidden");
  } finally {
    await stop(server);
  }
});

test("an admitted request still reaches the handler", async () => {
  const { server, url } = await boot({ requestRejection: () => undefined });
  try {
    const { status, body } = await call(url);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.value.branch, "main");
  } finally {
    await stop(server);
  }
});
