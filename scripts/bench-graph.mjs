/**
 * 性能基线：造大仓库，量 `graph` op 的耗时与返回体积。
 *
 * 用途：判断「上千提交要不要做行虚拟化」——渲染成本无法在 Node 里测，
 * 但「宿主耗时」和「JSON 体积」决定了前端至少要处理多少数据，
 * 这两项可以测，而且扩容前必须知道基线。
 *
 * 用法：node scripts/bench-graph.mjs [提交数...]   默认 300 2000 5000
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

const execFileAsync = promisify(execFile);
const counts = process.argv.slice(2).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
const sizes = counts.length > 0 ? counts : [300, 2000, 5000];

async function git(cwd, args, input) {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, input });
  return stdout;
}

/** 用 fast-import 一次性造 N 个提交（比 N 次 commit 快两个数量级）。 */
async function makeRepo(dir, n) {
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'bench@example.com']);
  await git(dir, ['config', 'user.name', 'Bench']);
  const base = Math.floor(Date.now() / 1000) - n * 60;
  const blob = 'line one\nline two\nline three\n';
  const chunks = [
    'blob', 'mark :1', `data ${blob.length}`, blob,
  ];
  for (let i = 1; i <= n; i += 1) {
    const msg = `commit ${i}: 性能基线用的提交标题`;
    const when = base + i * 60;
    chunks.push(
      'commit refs/heads/main',
      `mark :${i + 1}`,
      `author Bench <bench@example.com> ${when} +0800`,
      `committer Bench <bench@example.com> ${when} +0800`,
      `data ${Buffer.byteLength(msg)}`,
      msg,
      'M 100644 :1 dir/file.txt',
      '',
    );
  }
  chunks.push('done', '');
  await git(dir, ['fast-import', '--quiet'], chunks.join('\n'));
  // 打一个 tag、切一个分支，确保 ref 解析路径也覆盖到
  await git(dir, ['tag', 'v1.0.0', 'HEAD~1']);
  await git(dir, ['branch', 'feature/x', 'HEAD~2']);
}

/** 捕获插件注册的 /vsc-git-graph 路由并起一个真 HTTP server。 */
function serve() {
  let handler = null;
  apply({
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    effect(cb) { return cb(); },
  });
  if (!handler) throw new Error('route not registered');
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function call(port, op, payload) {
  const started = process.hrtime.bigint();
  const res = await fetch(`http://127.0.0.1:${port}/vsc-git-graph`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...payload }),
  });
  const text = await res.text();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, bytes: Buffer.byteLength(text), body: JSON.parse(text) };
}

const rows = [];
for (const n of sizes) {
  const dir = await mkdtemp(join(tmpdir(), `dsh-gg-bench-${n}-`));
  try {
    await makeRepo(dir, n);
    const { server, port } = await serve();
    try {
      // 1) 全部分支 + 默认 300 条（前端首屏）
      const first = await call(port, 'graph', { path: dir, maxCommits: 300 });
      // 2) 一次性要 n+10 条（最坏情况：全量渲染）
      const all = await call(port, 'graph', { path: dir, maxCommits: n + 10 });
      // 3) 两提交对比（CDV 里点文件前的那次）
      const hashes = all.body.value.commits.map((c) => c.hash);
      const cmp = await call(port, 'compare', { path: dir, a: hashes[Math.min(10, hashes.length - 1)], b: hashes[0] });
      rows.push({
        提交数: n,
        '首屏300条_ms': first.ms.toFixed(0),
        '首屏_KiB': (first.bytes / 1024).toFixed(0),
        '全量_ms': all.ms.toFixed(0),
        '全量_KiB': (all.bytes / 1024).toFixed(0),
        '单条字节': Math.round(all.bytes / Math.max(1, all.body.value.commits.length)),
        'compare_ms': cmp.ms.toFixed(0),
        'moreAvailable': all.body.value.moreAvailable,
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

console.table(rows);
