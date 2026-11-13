import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { apply } from '../lib/index.js';
const exec = promisify(execFile);
let repo, server, url, root, second, feature, merge, stash;
const git = async (...args) => (await exec('git', args, { cwd: repo })).stdout.trim();
const post = async (op, args={}) => (await fetch(url,{method:'POST',body:JSON.stringify({op,path:repo,...args})})).json();
const value = async (op,args) => {const r=await post(op,args);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
async function commit(file,text,message) {await writeFile(join(repo,file),text);await git('add','-A');await git('commit','-qm',message);return git('rev-parse','HEAD');}
before(async()=>{
  repo=await mkdtemp(join(tmpdir(),'host-graph-'));
  await git('init','-q','-b','main');await git('config','user.name','测试作者');await git('config','user.email','test@example.com');
  root=await commit('a.txt','one\n','root');second=await commit('a.txt','one\ntwo\n','second');
  await git('switch','-c','feature');feature=await commit('feature.txt','feature\n','feature');
  await git('switch','main');await commit('main.txt','main\n','main');await git('merge','--no-ff','feature','-m','merge');merge=await git('rev-parse','HEAD');
  await git('tag','light',second);await git('tag','-a','annotated','-m','annotation',merge);
  await git('update-ref','refs/remotes/origin/main',merge);
  await writeFile(join(repo,'a.txt'),'stash\n');await git('stash','push','-m','saved');stash=await git('rev-parse','refs/stash');
  await writeFile(join(repo,'a.txt'),'dirty\n');
  let handler;apply({effect:fn=>fn(),webServer:{register:r=>{handler=r.handler;return()=>{};}}});
  server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/vsc-git-graph`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(repo)await rm(repo,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
test('graph 保留父关系、分支、两种标签、远端和 stash',async()=>{
 const g=await value('graph');assert.equal(g.head,merge);assert.equal(g.headBranch,'main');assert.equal(g.commits[0].hash,'UNCOMMITTED');
 const m=g.commits.find(c=>c.hash===merge);assert.equal(m.parents.length,2);assert.ok(m.heads.includes('main'));assert.deepEqual(m.tags,[{name:'annotated',annotated:true}]);assert.equal(m.remotes[0].remote,'origin');
 assert.deepEqual(g.commits.find(c=>c.hash===second).tags,[{name:'light',annotated:false}]);assert.ok(g.commits.find(c=>c.hash===feature).heads.includes('feature'));
 assert.equal(g.commits.find(c=>c.hash===stash).stash.selector,'stash@{0}');assert.equal(g.commits.find(c=>c.hash===stash).stash.baseHash,merge);
});
test('showRemote=false 只隐藏远端标签，不按可达性丢历史',async()=>{
 const all=await value('graph',{showUncommitted:false});
 const local=await value('graph',{showUncommitted:false,showRemote:false});
 assert.deepEqual(local.commits.map(c=>c.hash),all.commits.map(c=>c.hash));
 assert.ok(local.commits.some(c=>c.hash===root),'origin 之前的共享历史必须保留');
 const m=local.commits.find(c=>c.hash===merge);
 assert.deepEqual(m.remotes,[]);assert.ok(m.heads.includes('main'));
 const hidden=await value('graph',{showUncommitted:false,hideRemotes:['origin']});
 assert.deepEqual(hidden.commits.map(c=>c.hash),all.commits.map(c=>c.hash));
 assert.ok(hidden.commits.every(c=>c.remotes.length===0));
 assert.ok(hidden.remotes.includes('origin'),'顶层远端名保留，推送/拉取仍要用');
  // showStashes=false 同理：只把 stash 排除出起点，不能按可达性把它的祖先（HEAD 历史）一起删掉
  const noStash=await value('graph',{showUncommitted:false,showStashes:false});
  assert.ok(!noStash.commits.some(c=>c.hash===stash));
  assert.ok(noStash.commits.some(c=>c.hash===root));
});
test('stash 内部提交被单独标记，stash 本体仍标 stash', async () => {
  const g=await value('graph',{showUncommitted:false});
  assert.equal(g.commits.find(c=>c.hash===stash).stash.selector,'stash@{0}');
  const internal=g.commits.filter(c=>c.stashInternal);
  assert.equal(internal.length,1,'无 -u 的 stash 只有一个 index 内部提交');
  assert.equal(internal[0].stashInternal.kind,'index');
  assert.equal(internal[0].stashInternal.selector,'stash@{0}');
});

test('分页多取一条且 skip 无重复',async()=>{const a=await value('graph',{maxCommits:2,showUncommitted:false}),b=await value('graph',{maxCommits:2,skip:2,showUncommitted:false});assert.equal(a.moreAvailable,true);assert.equal(a.commits.length,2);assert.equal(b.commits.length,2);assert.ok(!a.commits.some(c=>b.commits.some(d=>d.hash===c.hash)));});
test('根提交、合并提交详情与统计',async()=>{const a=await value('commitDetails',{hash:root});assert.equal(a.files[0].path,'a.txt');assert.equal(a.files[0].additions,1);assert.equal(a.files[0].binary,false);const b=await value('commitDetails',{hash:merge});assert.ok(b.files.some(f=>f.path==='feature.txt'));/* 详情不再解析 ref（少一次 spawn，约 60ms）：标签归属由 graph 覆盖 */assert.ok(Array.isArray(b.commit.tags));assert.equal((await value('graph')).commits.find(c=>c.hash===merge).tags[0].name,'annotated');});
test('比较提交和工作区',async()=>{const a=await value('compare',{a:root,b:second});assert.equal(a.files[0].additions,1);const b=await value('compare',{a:merge,b:'UNCOMMITTED'});assert.ok(b.files.some(f=>f.path==='a.txt'));const c=await value('commitDetails',{hash:'UNCOMMITTED'});assert.equal(c.files[0].path,'a.txt');assert.ok(c.files[0].deletions>0);});
test('历史和工作区文件 diff',async()=>{assert.match((await value('fileDiff',{hash:second,file:'a.txt'})).text,/\+two/);assert.match((await value('fileDiff',{file:'a.txt'})).text,/\+dirty/);assert.equal((await value('fileDiff',{file:'a.txt'})).truncated,false);});
test('拒绝选项和空白引用',async()=>{for(const [op,args,code] of [['graph',{branches:['-D']},'invalid-ref'],['graph',{hideRemotes:['-D']},'invalid-ref'],['fileDiff',{file:'-D'},'invalid-path'],['checkoutBranch',{name:'-D'},'invalid-ref'],['tagAdd',{name:'-D',hash:merge},'invalid-ref'],['fetch',{remote:'-D'},'invalid-ref'],['compare',{a:'bad ref',b:root},'invalid-ref']]){const r=await post(op,args);assert.equal(r.error.code,code);}});
test('干净工作区不产生伪提交，支持重命名与二进制',async()=>{await git('restore','a.txt');assert.ok(!(await value('graph')).commits.some(c=>c.hash==='UNCOMMITTED'));await rename(join(repo,'a.txt'),join(repo,'renamed.txt'));await writeFile(join(repo,'binary.dat'),Buffer.from([0,1,2]));await git('add','-A');await git('commit','-qm','rename and binary');const d=await value('commitDetails',{hash:await git('rev-parse','HEAD')});assert.ok(d.files.some(f=>f.status==='R'&&f.oldPath==='a.txt'));assert.ok(d.files.some(f=>f.path==='binary.dat'&&f.binary));});
test('动作入口和原始错误',async()=>{await value('createBranch',{name:'temporary',hash:root});await value('checkoutBranch',{name:'temporary'});await value('checkoutCommit',{hash:root});await value('checkoutBranch',{name:'main'});await value('deleteBranch',{name:'temporary',force:true});await value('tagAdd',{name:'temporary-tag',hash:root});await value('tagDelete',{name:'temporary-tag'});assert.match((await value('stashList')).stdout,/stash@\{0\}/);const r=await post('checkoutBranch',{name:'missing-branch'});assert.equal(r.error.code,'git-error');assert.match(r.error.message,/missing-branch/);});

test('stash -u 的 index / untracked 内部提交都标记，且不标成 stash 本体', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-stash-'));
  const run = (...args) => exec('git', args, { cwd: dir });
  try {
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 't@example.com');
    await run('config', 'user.name', 't');
    await writeFile(join(dir, 'a.txt'), 'one\n');
    await run('add', '-A');
    await run('commit', '-qm', 'init');
    await writeFile(join(dir, 'a.txt'), 'two\n');
    await writeFile(join(dir, 'untracked.txt'), 'u\n');
    await run('stash', 'push', '-u', '-q', '-m', 's');

    const r = await (await fetch(url, { method: 'POST', body: JSON.stringify({ op: 'graph', path: dir, showUncommitted: false }) })).json();
    assert.equal(r.ok, true, JSON.stringify(r));
    const internal = r.value.commits.filter((c) => c.stashInternal).map((c) => c.stashInternal.kind).sort();
    assert.deepEqual(internal, ['index', 'untracked']);
    assert.ok(r.value.commits.find((c) => c.stash), 'stash 本体仍标 stash');
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
});

test('pullBranch 把 origin/main 拆成 remote + remoteRef（当仓库名会报 not a git repository）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-pull-'));
  const bare = dir + '-origin.git';
  const run = (cwd, ...args) => exec('git', args, { cwd });
  try {
    await exec('git', ['init', '--bare', '-q', bare]);
    await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await run(dir, 'config', 'user.email', 't@example.com');
    await run(dir, 'config', 'user.name', 't');
    await writeFile(join(dir, 'a.txt'), 'x\n');
    await run(dir, 'add', '-A');
    await run(dir, 'commit', '-qm', 'init');
    await run(dir, 'remote', 'add', 'origin', bare);
    await run(dir, 'push', '-q', '-u', 'origin', 'main');

    const body = JSON.stringify({ op: 'pullBranch', path: dir, branch: 'origin/main' });
    const r = await (await fetch(url, { method: 'POST', body })).json();
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    await rm(bare, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
});
