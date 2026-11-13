/**
 * Integration smoke test: build a real git repository, boot the plugin's
 * `apply()` against a stub webServer, serve the registered `/vsc-git-graph` and `/fs`
 * routes over a real HTTP server, and drive them end-to-end with fetch().
 *
 * Run with: node --test test/integration.test.js
 * Requires `git` on PATH (git >= 2.28 for `-b`).
 */
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir, readFile, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../lib/index.js";

const execFileAsync = promisify(execFile);

let repo;
let server;
let port;
let routes;

function captureRoutes() {
  const registrations = [];
  const ctx = {
    webServer: {
      register(route) {
        registrations.push(route);
        return () => {};
      },
    },
    effect(cb) {
      return cb();
    },
  };
  apply(ctx);
  return registrations;
}

function gitRun(cwd, args) {
  return execFileAsync("git", args, { cwd, encoding: "utf8" });
}

/**
 * 稳健清理临时目录：Windows 下 git / 文件句柄可能延迟释放，导致 rm 报 EBUSY；
 * 用线性退避重试，全部失败后放弃（残留临时目录不影响测试语义）。
 */
async function rmRetry(dir, attempts = 6) {
  if (!dir) return;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch {
      if (i === attempts - 1) return;
      await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)));
    }
  }
}

/** 在指定目录初始化一个带一次提交的仓库（git >= 2.28 的 `init -b`）。 */
async function initRepo(dir) {
  await mkdir(dir, { recursive: true });
  await gitRun(dir, ["init", "-q", "-b", "main"]);
  await gitRun(dir, ["config", "user.email", "test@example.com"]);
  await gitRun(dir, ["config", "user.name", "Test User"]);
  await writeFile(join(dir, "a.txt"), "hello\n");
  await gitRun(dir, ["add", "-A"]);
  await gitRun(dir, ["commit", "-q", "-m", "initial"]);
}

async function post(pathname, body) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

before(async () => {
  repo = await mkdtemp(join(tmpdir(), "dsh-git-graph-it-"));
  await gitRun(repo, ["init", "-q", "-b", "main"]);
  await gitRun(repo, ["config", "user.email", "test@example.com"]);
  await gitRun(repo, ["config", "user.name", "Test User"]);
  await writeFile(join(repo, "a.txt"), "hello\n");
  await gitRun(repo, ["add", "-A"]);
  await gitRun(repo, ["commit", "-q", "-m", "initial"]);

  routes = captureRoutes();
  assert.equal(routes.length, 1, "git-only mode: apply() must register exactly /vsc-git-graph");

  server = http.createServer((req, res) => {
    const route = routes.find((r) => req.url === r.path);
    if (!route) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: { code: "no-route", message: req.url } }));
      return;
    }
    route.handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  // Windows 下句柄可能延迟释放导致 EBUSY：交由退避重试清理，不因清理失败判定测试失败
  await rmRetry(repo);
});

test("apply() exposes /vsc-git-graph only (file browser /fs disabled for now)", async () => {
  assert.ok(routes.some((r) => r.path === "/vsc-git-graph"));
  assert.ok(!routes.some((r) => r.path === "/fs"), "git-only mode: /fs must not be registered");
});

test("apply() skips gracefully when /vsc-git-graph is already registered (desktop built-in conflict)", () => {
  const exact = new Map();
  const ws = {
    register(route) {
      if (exact.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`);
      exact.set(route.path, route);
      return () => exact.delete(route.path);
    },
  };
  // Simulate the desktop app's built-in git viewer already owning the routes.
  ws.register({ kind: "exact", path: "/vsc-git-graph", handler: () => {} });
  const ctx = { webServer: ws, effect(cb) { return cb(); } };
  assert.doesNotThrow(() => apply(ctx)); // must not crash the layer
  assert.equal(exact.size, 1); // routes stay owned by the built-in plugin
});

test("/vsc-git-graph status reports the working tree split", async () => {
  await writeFile(join(repo, "a.txt"), "hello world\n");
  await writeFile(join(repo, "b.txt"), "new\n");
  const res = await post("/vsc-git-graph", { op: "status", path: repo });
  assert.equal(res.ok, true);
  assert.equal(res.value.branch, "main");
  assert.deepEqual(res.value.unstaged.map((f) => f.path), ["a.txt"]);
  assert.deepEqual(res.value.untracked.map((f) => f.path), ["b.txt"]);
});

test("/vsc-git-graph stage + status flips a file to staged", async () => {
  const staged = await post("/vsc-git-graph", { op: "stage", path: repo, files: ["a.txt"] });
  assert.equal(staged.ok, true);
  const status = await post("/vsc-git-graph", { op: "status", path: repo });
  assert.deepEqual(status.value.staged.map((f) => f.path), ["a.txt"]);
});

test("/vsc-git-graph commit of selected files records a commit and clears it", async () => {
  const commit = await post("/vsc-git-graph", { op: "commit", path: repo, message: "edit a", files: ["a.txt"] });
  assert.equal(commit.ok, true, JSON.stringify(commit));
  const status = await post("/vsc-git-graph", { op: "status", path: repo });
  assert.equal(status.value.staged.length, 0);
  assert.deepEqual(status.value.untracked.map((f) => f.path), ["b.txt"]);
});

test("/vsc-git-graph keeps non-ASCII (Chinese) paths readable and stageable", async () => {
  const name = "中文 测试文档.md";
  const file = join(repo, name);
  await writeFile(file, "中文\n");
  try {
    const status = await post("/vsc-git-graph", { op: "status", path: repo });
    assert.equal(status.ok, true, JSON.stringify(status));
    // Before the fix git returned the name C-quoted with octal escapes.
    assert.deepEqual(status.value.untracked.map((f) => f.path).sort(), [name, "b.txt"].sort());

    const staged = await post("/vsc-git-graph", { op: "stage", path: repo, files: [name] });
    assert.equal(staged.ok, true, JSON.stringify(staged));

    const stagedOnly = await post("/vsc-git-graph", { op: "staged", path: repo });
    assert.equal(stagedOnly.ok, true, JSON.stringify(stagedOnly));
    assert.deepEqual(stagedOnly.value.files.map((f) => f.path), [name]);

    const after = await post("/vsc-git-graph", { op: "status", path: repo });
    assert.deepEqual(after.value.staged.map((f) => f.path), [name]);
  } finally {
    await gitRun(repo, ["reset", "-q"]);
    await rmRetry(file);
  }
});

test("/vsc-git-graph log lists both commits", async () => {
  const res = await post("/vsc-git-graph", { op: "log", path: repo, n: 10 });
  assert.equal(res.ok, true);
  assert.ok(res.value.commits.length >= 2);
  assert.equal(res.value.commits.at(-1).subject, "initial");
});

test("/vsc-git-graph graphLog returns rows with parents for a commit graph", async () => {
  const res = await post("/vsc-git-graph", { op: "graphLog", path: repo, n: 10 });
  assert.equal(res.ok, true);
  assert.ok(res.value.rows.length >= 2);
  assert.ok(res.value.rows.every((r) => r.hash && r.subject));
});

test("graph branch switch refreshes HEAD and preserves conflicting edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-vsc-git-switch-"));
  const call = (op, args = {}) => post("/vsc-git-graph", { op, path: directory, ...args });
  try {
    await initRepo(directory);
    await gitRun(directory, ["switch", "-c", "feature/topic"]);
    await writeFile(join(directory, "a.txt"), "feature\n");
    await gitRun(directory, ["commit", "-am", "feature change"]);
    await gitRun(directory, ["switch", "main"]);
    await gitRun(directory, ["branch", "topic"]);
    await writeFile(join(directory, "b.txt"), "main\n");
    await gitRun(directory, ["add", "b.txt"]);
    await gitRun(directory, ["commit", "-m", "main change"]);
    const initial = await call("graphLog");
    assert.ok(initial.value.rows.some((row) => row.refs.includes("HEAD -> main")));
    assert.ok(initial.value.rows.some((row) => row.refs.includes("feature/topic")));
    const switched = await call("switchBranch", { name: "feature/topic", localOnly: true });
    assert.equal(switched.ok, true, switched.error?.message);
    const updated = await call("graphLog");
    assert.ok(updated.value.rows.some((row) => row.refs.includes("HEAD -> feature/topic")));
    await writeFile(join(directory, "a.txt"), "uncommitted\n");
    const rejected = await call("switchBranch", { name: "main", localOnly: true });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error.message, /would be overwritten/i);
    const head = await gitRun(directory, ["branch", "--show-current"]);
    assert.equal(head.stdout.trim(), "feature/topic");
    const diff = await gitRun(directory, ["diff", "--", "a.txt"]);
    assert.match(diff.stdout, /\+uncommitted/);
    const missing = await call("switchBranch", { name: "missing/topic", localOnly: true });
    assert.equal(missing.ok, false, "a failed local switch must not retry an unrelated branch");
    assert.equal((await gitRun(directory, ["branch", "--show-current"])).stdout.trim(), "feature/topic");
  } finally {
    await rmRetry(directory);
  }
});

test("/vsc-git-graph blame annotates a committed file", async () => {
  const res = await post("/vsc-git-graph", { op: "blame", path: repo, file: "a.txt" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.value.lines.length >= 1);
  assert.equal(res.value.lines[0].content, "hello world");
});

test("/vsc-git-graph rejects unknown ops, bad JSON and non-POST", async () => {
  const badOp = await post("/vsc-git-graph", { op: "nope", path: repo });
  assert.equal(badOp.ok, false);
  assert.equal(badOp.error.code, "bad-op");

  const badJson = await fetch(`http://127.0.0.1:${port}/vsc-git-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  }).then((r) => r.json());
  assert.equal(badJson.error.code, "bad-json");

  const wrongMethod = await fetch(`http://127.0.0.1:${port}/vsc-git-graph`).then((r) => r.json());
  assert.equal(wrongMethod.error.code, "method");
});

test("/fs is not served in git-only mode", async () => {
  const res = await post("/fs", { op: "tree", root: repo });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "no-route");
});

test("/vsc-git-graph tags reports the tag checked out, and switchTag detaches HEAD", async () => {
  await gitRun(repo, ["tag", "-a", "v0.0.1", "-m", "first tag"]);

  const onBranch = await post("/vsc-git-graph", { op: "tags", path: repo });
  assert.equal(onBranch.ok, true, JSON.stringify(onBranch));
  assert.ok(onBranch.value.tags.some((t) => t.name === "v0.0.1"));
  // On a branch — even one sitting on a tagged commit — nothing is "checked out".
  assert.equal(onBranch.value.current, "");

  const switched = await post("/vsc-git-graph", { op: "switchTag", path: repo, name: "v0.0.1" });
  assert.equal(switched.ok, true, JSON.stringify(switched));

  const detached = await post("/vsc-git-graph", { op: "tags", path: repo });
  assert.equal(detached.value.current, "v0.0.1");
  const status = await post("/vsc-git-graph", { op: "status", path: repo });
  assert.match(status.value.branch, /HEAD/, "switching to a tag leaves a detached HEAD");

  const back = await post("/vsc-git-graph", { op: "switchBranch", path: repo, name: "main" });
  assert.equal(back.ok, true, JSON.stringify(back));
  const restored = await post("/vsc-git-graph", { op: "tags", path: repo });
  assert.equal(restored.value.current, "");
});

test("/vsc-git-graph switchTag surfaces a clean error for an unknown tag", async () => {
  const res = await post("/vsc-git-graph", { op: "switchTag", path: repo, name: "v9.9.9-nope" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "git-error");
});

test("/vsc-git-graph status flags the plugin's own source tree (self-hosting guard)", async () => {
  const other = await post("/vsc-git-graph", { op: "status", path: repo });
  assert.equal(other.ok, true);
  assert.equal(other.value.self, false, "a temp repo is not the plugin tree");

  const selfRoot = fileURLToPath(new URL("..", import.meta.url));
  const self = await post("/vsc-git-graph", { op: "status", path: selfRoot });
  assert.equal(self.ok, true, JSON.stringify(self));
  assert.equal(self.value.self, true, "the plugin's own checkout must be flagged");
});

test("/vsc-git-graph graphLog omits stash nodes", async () => {
  const stashRepo = await mkdtemp(join(tmpdir(), "dsh-git-graph-stash-"));
  try {
    await gitRun(stashRepo, ["init", "-q", "-b", "main"]);
    await gitRun(stashRepo, ["config", "user.email", "test@example.com"]);
    await gitRun(stashRepo, ["config", "user.name", "Test User"]);
    await writeFile(join(stashRepo, "f.txt"), "one\n");
    await gitRun(stashRepo, ["add", "-A"]);
    await gitRun(stashRepo, ["commit", "-q", "-m", "base"]);
    await writeFile(join(stashRepo, "f.txt"), "two\n");
    await gitRun(stashRepo, ["stash", "push", "-q", "-m", "wip"]);

    const stashHash = (await gitRun(stashRepo, ["rev-parse", "refs/stash"])).stdout.trim();
    const res = await post("/vsc-git-graph", { op: "graphLog", path: stashRepo, n: 50 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.value.rows.some((r) => r.subject === "base"), "branch commits stay in the graph");
    assert.ok(
      !res.value.rows.some((r) => r.hash === stashHash),
      "the stash commit (refs/stash) must not appear in the graph",
    );
  } finally {
    await rm(stashRepo, { recursive: true, force: true });
  }
});

// ── listRepos 端到端：多仓发现 / worktree 归组 / 根三态 ─────────────────────

describe("listRepos 端到端（多仓 / worktree / bare / 根三态）", () => {
  let mroot;        // 扫描根本身不是仓库
  let outsideRoot;  // 根外 worktree 的宿主目录
  let emptyRoot;    // 空目录根
  let proj;         // 主仓
  let projWt;       // 同级 linked worktree

  before(async () => {
    mroot = await mkdtemp(join(tmpdir(), "dsh-git-graph-multi-"));
    outsideRoot = await mkdtemp(join(tmpdir(), "dsh-git-graph-out-"));
    emptyRoot = await mkdtemp(join(tmpdir(), "dsh-git-graph-empty-"));

    await initRepo(join(mroot, "plain"));
    await initRepo(join(mroot, "nested", "deep")); // 孙目录命中

    proj = join(mroot, "proj");
    await initRepo(proj);
    projWt = join(mroot, "proj-wt");
    await gitRun(proj, ["worktree", "add", "-q", "-b", "feat", projWt]);
    // 布局 B：worktree 位于主仓内部（扫描命中 proj 后不下探，靠 worktree list 通道发现）
    await gitRun(proj, ["worktree", "add", "-q", "-b", "inner", join(proj, "worktrees", "inner")]);
    // 手删残留：目录已不存在但 worktree 注册表仍列出（prunable），必须被存在性兜底剔除
    const goneWt = join(mroot, "gone-wt");
    await gitRun(proj, ["worktree", "add", "-q", "-b", "gone", goneWt]);
    await rmRetry(goneWt);
    // 真实场景：DSH 会话在 .agents/worktrees/ 下开 worktree（点目录不被扫描，
    // 历史上由 worktree list 通道混进切换器）——现在一律不当作仓库。
    await gitRun(proj, ["worktree", "add", "-q", "-b", "agent", join(proj, ".agents", "worktrees", "dsh-1")]);
        // 根外 worktree：同组成员但位于扫描根之外，不得进入切换器
    await gitRun(proj, ["worktree", "add", "-q", "-b", "outside", join(outsideRoot, "outside-wt")]);

    // bare 主仓 + 其 linked worktree：bare 本体的 .git 形态不存在故不被扫描命中，
    // bare 组条目只应剩下 linked worktree
    const seed = join(outsideRoot, "seed");
    await initRepo(seed);
    const bareGit = join(mroot, "bare.git");
    await gitRun(outsideRoot, ["clone", "-q", "--bare", seed, bareGit]);
    await gitRun(bareGit, ["worktree", "add", "-q", "-b", "baremain", join(mroot, "bare-wt")]);
  });

  after(async () => {
    await rmRetry(mroot);
    await rmRetry(outsideRoot);
    await rmRetry(emptyRoot);
  });

  test("非仓库根：只列真正的子仓库，worktree 一律不算仓库", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.rootIsRepo, false);
    assert.equal(res.value.truncated, "");

    const rels = res.value.repos.map((r) => r.relPath);
    // proj-wt / proj/worktrees/inner 是 proj 的工作树，bare-wt 是 bare 仓的工作树：
    // 它们都是分支的工作目录，不是「另一个仓库」，不得进入切换器。
    assert.deepEqual([...rels].sort(), ["nested/deep", "plain", "proj"]);
    assert.deepEqual(rels, [...rels].sort((a, b) => a.localeCompare(b)), "repos 必须按 relPath 排序");
    assert.equal(new Set(res.value.repos.map((r) => r.path)).size, res.value.repos.length, "归一化路径不得重复");

    const byRel = Object.fromEntries(res.value.repos.map((r) => [r.relPath, r]));
    assert.equal(byRel.proj.worktree.role, "main");
    assert.equal(byRel.proj.branch, "main");
    for (const excluded of ["proj-wt", "proj/worktrees/inner", "proj/.agents/worktrees/dsh-1", "bare-wt", "gone-wt"]) {
      assert.ok(!rels.includes(excluded), `${excluded} 是工作树，不得列为仓库`);
    }
    // 手删残留：porcelain 仍列出（prunable），也不能因为 worktree 通道复活
    const porcelain = (await gitRun(proj, ["worktree", "list", "--porcelain"])).stdout;
    assert.match(porcelain, /gone-wt/, "夹具前提：手删残留仍留在 worktree 注册表中");
    assert.ok(!res.value.repos.some((r) => r.prunable), "失效条目不得进入响应");
    // 根外 worktree 不得进入切换器
    assert.ok(!res.value.repos.some((r) => r.path.includes("outside-wt")));
    // head 契约：8 位短哈希
    for (const item of res.value.repos) assert.equal(item.head.length, 8, `${item.relPath} 的 head 必须为 8 位`);
  });

  test("根为主仓：只列根条目，内部 worktree 不占位", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: proj, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.rootIsRepo, true);
    const rels = res.value.repos.map((r) => r.relPath);
    assert.equal(rels[0], ".", "根条目必须排最前");
    assert.ok(!rels.includes("worktrees/inner"), "主仓内部的 worktree 不是仓库，不得入列");
    assert.ok(!rels.some((r) => r.includes(".agents")), "DSH 会话 worktree（.agents/ 下）不得入列");
    assert.ok(!rels.some((r) => r.startsWith("..")), "根外 worktree 不得泄漏");
    assert.ok(!rels.includes("proj-wt"));
    assert.equal(res.value.repos[0].worktree.role, "main");
    assert.equal(res.value.repos[0].branch, "main");
    assert.equal(res.value.repos[0].path, res.value.root);
    assert.equal(res.value.repos[0].relPath, ".");
  });

  test("根为 linked worktree（.git 文件态）：rootIsRepo=true，根条目 role 固定 main", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: projWt, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.rootIsRepo, true, "根下 .git 为文件也必须判定为仓库");
    assert.deepEqual(res.value.repos.map((r) => r.relPath), ["."]);
    assert.equal(res.value.repos[0].worktree.role, "main", "数据层约定：根条目 role 恒为 main");
    assert.equal(res.value.repos[0].branch, "feat");
    assert.equal(res.value.repos[0].head.length, 8);
  });

  test("空目录根：rootIsRepo=false 且 repos 为空（维持现状而非报错）", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: emptyRoot, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.rootIsRepo, false);
    assert.deepEqual(res.value.repos, []);
    assert.equal(res.value.truncated, "");
  });

  test("depth 语义：1 只扫子目录，非法值落缺省 2", async () => {
    const depth1 = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 1 });
    assert.equal(depth1.ok, true);
    assert.ok(!depth1.value.repos.some((r) => r.relPath === "nested/deep"), "depth=1 不得发现孙目录仓库");
    assert.ok(depth1.value.repos.some((r) => r.relPath === "plain"));

    for (const depth of [0, -3, 1.5, "2", null]) {
      const res = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth });
      assert.equal(res.ok, true, `depth=${String(depth)} 不得失败`);
      assert.ok(res.value.repos.some((r) => r.relPath === "nested/deep"), `depth=${String(depth)} 必须落缺省 2`);
    }
    const clamped = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 99 });
    assert.equal(clamped.ok, true, "越界 depth 必须钳制到边界而非报错");
    assert.ok(clamped.value.repos.some((r) => r.relPath === "nested/deep"));
  });

  test("repos 截断：注入 maxRepos 小值 → 按 relPath 排序取前 N，truncated='repos'", async () => {
    const full = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 2 });
    assert.equal(full.ok, true, JSON.stringify(full));
    const sorted = full.value.repos.map((r) => r.relPath).sort((a, b) => a.localeCompare(b));

    const res = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 2, limits: { maxRepos: 2 } });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.repos.length, 2);
    assert.deepEqual(res.value.repos.map((r) => r.relPath), sorted.slice(0, 2), "截断必须先排序再取前 N");
    assert.equal(res.value.truncated, "repos");

    // 注入只能收紧：放大到超过默认上限不改变默认语义
    const widened = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 2, limits: { maxRepos: 9999 } });
    assert.equal(widened.ok, true);
    assert.equal(widened.value.truncated, "");
  });

  test("超时：注入 timeoutMs=0 返回结构完整的部分结果与 truncated='timeout'", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 2, limits: { timeoutMs: 0 } });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.truncated, "timeout");
    assert.ok(Array.isArray(res.value.repos));
    assert.equal(typeof res.value.rootIsRepo, "boolean");
    assert.equal(typeof res.value.root, "string");
  });

  test("非法路径与缺失 path → invalid-path（不崩溃）", async () => {
    const missing = await post("/vsc-git-graph", { op: "listRepos", path: join(mroot, "no-such-dir-xyz") });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "invalid-path");

    const noPath = await post("/vsc-git-graph", { op: "listRepos" });
    assert.equal(noPath.ok, false);
    assert.equal(noPath.error.code, "invalid-path");
  });

  test("入口 realpath 归一化：8.3 短名根展开为长名后仍匹配长名 porcelain 条目", async (t) => {
    const long = await realpath(mroot);
    const res = await post("/vsc-git-graph", { op: "listRepos", path: mroot, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.root, long, "响应 root 必须是 realpath 归一化后的长名路径");
    if (mroot === long) {
      t.skip("本机临时目录已是长名形态，无法构造 8.3 短名场景");
      return;
    }
    // 短名根下 in-root 判定与 role 判定依赖 realpath：不归一化会全数失配
    assert.ok(res.value.repos.some((r) => r.relPath === "plain"));
    assert.equal(res.value.repos.find((r) => r.relPath === "proj").worktree.role, "main");
    assert.ok(res.value.repos.every((r) => !r.relPath.startsWith("..")));
  });
});

// ── listRepos 端到端：submodule 幽灵条目 ────────────────────────────────────

describe("listRepos 端到端（submodule 幽灵条目）", () => {
  let sroot;
  let superRepo;
  let subDir;

  before(async () => {
    sroot = await mkdtemp(join(tmpdir(), "dsh-git-graph-sub-"));
    await initRepo(join(sroot, "libsrc"));
    superRepo = join(sroot, "super");
    await initRepo(superRepo);
    // 本地路径 submodule 需显式放行 file 协议（git >= 2.38）
    await gitRun(superRepo, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", join(sroot, "libsrc"), "sub"]);
    await gitRun(superRepo, ["commit", "-q", "-m", "add submodule"]);
    subDir = join(superRepo, "sub");
  });

  after(async () => {
    await rmRetry(sroot);
  });

  test("主仓根：submodule 工作目录作为独立仓库入列，gitdir 幽灵条目不出现", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: superRepo, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    const ghosts = res.value.repos.filter((r) => r.path.replace(/\\/g, "/").includes(".git/modules"));
    assert.deepEqual(ghosts, [], "不得出现 submodule 的 gitdir 幽灵条目");
    const sub = res.value.repos.find((r) => r.relPath === "sub");
    assert.ok(sub, "submodule 工作目录必须入列");
    assert.equal(sub.worktree.role, "main", "submodule 的工作目录就是它自己仓库的主工作树");
    assert.equal(sub.head.length, 8, "直取路径 head 固定 8 位");
  });

  test("submodule 工作目录为根：幽灵条目被过滤，仅剩根条目", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: subDir, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.rootIsRepo, true, "submodule 的 .git 是文件态");
    assert.equal(res.value.repos.length, 1);
    assert.equal(res.value.repos[0].relPath, ".");
    assert.equal(res.value.repos[0].head.length, 8);
    assert.deepEqual(res.value.repos.filter((r) => r.path.replace(/\\/g, "/").includes(".git/modules")), []);
  });

  test("上层根：命中主仓后不下探，submodule 不重复发现且无幽灵路径", async () => {
    const res = await post("/vsc-git-graph", { op: "listRepos", path: sroot, depth: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.value.repos.map((r) => r.relPath), ["libsrc", "super"]);
    assert.deepEqual(res.value.repos.filter((r) => r.path.replace(/\\/g, "/").includes(".git/modules")), []);
  });
});

// ── listRepos 端到端：组合截断语义（多原因同时成立 / timeout 覆盖）──────────

describe("listRepos 端到端（组合截断语义）", () => {
  let croot; // 根本身即仓库，含 2 个子仓与若干非候选条目

  before(async () => {
    croot = await mkdtemp(join(tmpdir(), "dsh-git-graph-combo-"));
    await initRepo(croot);                      // 根探测通道产出根条目
    await initRepo(join(croot, "sub-a"));       // 子仓 1
    await initRepo(join(croot, "sub-b"));       // 子仓 2
    await writeFile(join(croot, "readme.md"), "x\n");
    await mkdir(join(croot, ".cache"), { recursive: true });
  });

  after(async () => {
    await rmRetry(croot);
  });

  test("多次触发截断：repos 与 dirs 同时成立 → 'repos+dirs'（repos 在前）", async () => {
    const full = await post("/vsc-git-graph", { op: "listRepos", path: croot, depth: 2 });
    assert.equal(full.ok, true, JSON.stringify(full));
    assert.equal(full.value.rootIsRepo, true);
    const sorted = full.value.repos.map((r) => r.relPath).sort((a, b) => a.localeCompare(b));
    assert.deepEqual([...sorted].sort(), [".", "sub-a", "sub-b"], "夹具前提：根条目 + 两个子仓");

    // maxEntries=1 → 两个候选子目录必然触发 dirs；maxRepos=1 → 合并后的 3 条必然触发 repos
    const res = await post("/vsc-git-graph", { op: "listRepos", path: croot, depth: 2, limits: { maxRepos: 1, maxEntries: 1 } });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.truncated, "repos+dirs", "两个原因必须同时成立并按 repos → dirs 顺序拼接");
    assert.deepEqual(res.value.repos.map((r) => r.relPath), sorted.slice(0, 1), "repos 截断取排序后的前 N 项");
    assert.equal(res.value.repos.length, 1);
  });

  test("超时覆盖其余原因：repos+dirs 同时成立时 truncated='timeout'（不出现 timeout+…）", async () => {
    const res = await post("/vsc-git-graph", {
      op: "listRepos",
      path: croot,
      depth: 2,
      limits: { maxRepos: 1, maxEntries: 1, timeoutMs: 0 },
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.value.truncated, "timeout", "timeout 恒覆盖 repos / dirs 原因");
    assert.equal(res.value.rootIsRepo, true);
    assert.ok(Array.isArray(res.value.repos));
    assert.equal(typeof res.value.root, "string");
  });

  test("目录上限只被候选目录消耗：maxEntries=1 + 文件/点目录/符号链接 → 不触发 dirs", async () => {
    const limitRoot = await mkdtemp(join(tmpdir(), "dsh-git-graph-limit-"));
    try {
      await initRepo(join(limitRoot, "z-repo"));      // 唯一候选目录
      await writeFile(join(limitRoot, "a-file.txt"), "x\n");
      await mkdir(join(limitRoot, ".a-dotdir"), { recursive: true });
      try {
        // 符号链接（Windows 用免管理员的 junction）同样是非候选；创建失败时本用例退化为
        // 「普通文件 + 点目录」两种非候选，断言不变
        await symlink(join(limitRoot, "z-repo"), join(limitRoot, "a-link"), process.platform === "win32" ? "junction" : "dir");
      } catch { /* 无权限平台：忽略该非候选类型 */ }

      const res = await post("/vsc-git-graph", { op: "listRepos", path: limitRoot, depth: 2, limits: { maxEntries: 1 } });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.value.truncated, "", "普通文件 / 点目录 / 符号链接不得消耗目录上限");
      assert.deepEqual(res.value.repos.map((r) => r.relPath), ["z-repo"]);
    } finally {
      await rmRetry(limitRoot);
    }
  });
});

