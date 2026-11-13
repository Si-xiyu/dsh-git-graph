import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, writeFile, rm, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name,root),'utf8');
const sourceNames = ['graph','diff','styles','view','module'];
const bundle = await read('lib/client.js');
const view = await read('src/view.js');
const styles = await read('src/styles.js');
const build = await read('scripts/build.mjs');
function helpers(react = {}) {
  const jsx=(type,props,key)=>({type,props,key});
  const runtime={useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:()=>({current:null}),useMemo:f=>f(),useLayoutEffect:()=>{},useEffect:()=>{},...react};
  return new Function('require', (graph+'\n'+view+'\n'+diff).replace(/^\s*export /gm,'')+'\nreturn {gitCall,FormDialog,CommitDetails,DiffView,parseDiffText,GitGraphView,RepoBar,repoLabel,mergeRepositories,tooltipPills};')(name=>name==='react'?runtime:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:{});
}
const diff=await read('src/diff.js');
const graph=await read('src/graph.js');
test('构建产物可解析并注册正确模块',()=>{
  new Function(bundle);
  assert.match(bundle,/window\.__ModuleLoader__\.load/);
  assert.match(bundle,/id: "dsh-vsc-git-graph"/);
  assert.doesNotMatch(bundle,/\b(?:export|import)\s/);
  let registration;
  new Function('window',bundle)({__ModuleLoader__:{load:value=>registration=value}});
  const empty=()=>{};
  const loaded=registration.factory(name=>name==='react/jsx-runtime'?{jsx:empty,jsxs:empty,Fragment:empty}:{});
  assert.deepEqual(loaded.inject,['slots','locale']);
  let slot;
  loaded.apply({slots:{inject:(name,f)=>{assert.equal(name,'conversation.view');f();},register:(options,component)=>{slot=options;assert.equal(typeof component,'function');}}});
  assert.equal(slot.id,'vsc-git-graph');assert.equal(slot.order,21);assert.equal(slot.label(),'Git Graph');assert.deepEqual(slot.inject(),{});
});
test('源码与运行时兼容红线保留',async()=>{
  for(const name of sourceNames){const text=await read('src/'+name+'.js');assert.ok(text.trim().length>50);assert.doesNotMatch(text,/\bimport\s|export default/);}
  assert.match(view,/props\.sessionId \|\| s\.current/);
  assert.match(view,/const BranchIcon = primitives\.IconBranchOutline16 \|\| primitives\.IconBranchOutlineRegular \|\| primitives\.IconBranchOutlineMedium \|\| \(\(\) => null\)/);
  assert.match(build,/throw new Error/);assert.match(build,/new Function\(output\)/);
  assert.match(view,/new ResizeObserver/);assert.match(view,/grid:\s*\{\s*expandY\s*\}/);
});
test('仓库自动发现：名称带分支，根仓库标「根」，结果并入并保留手动路径',()=>{
  const {repoLabel,mergeRepositories}=helpers();
  assert.equal(repoLabel({path:'E:/work/app',name:'app',branch:'main',relPath:'.'}),'app（main） · 根');
  assert.equal(repoLabel({path:'E:/work/pkg/lib',name:'lib',branch:'dev',relPath:'pkg/lib'}),'lib（dev） · pkg/lib');
  const en=(zh,text)=>text;
  assert.equal(repoLabel({path:'E:/work/app',name:'app',branch:'main',relPath:'.'},en),'app (main) · root');
  // worktree 的名字常与分支同名：括号里的分支是重复信息，省掉
  assert.equal(repoLabel({path:'E:/work/app/.agents/worktrees/w1',name:'w1',branch:'w1',relPath:'.agents/worktrees/w1'}),'w1 · .agents/worktrees/w1');
  const merged=mergeRepositories(
    [{path:'E:/work/app',name:'app',branch:'main',relPath:'.',prunable:''}],
    [{path:'E:/manual',name:'manual',branch:'',relPath:'.',prunable:''}],
    'E:/manual',
  );
  assert.deepEqual(merged.map(repo=>repo.path),['E:/work/app','E:/manual']);
  assert.equal(merged[0].branch,'main');
});
test('仓库路径默认只读：单仓纯文本、多仓下拉，没有手动输入路径入口',()=>{
  const {RepoBar}=helpers();
  const repos=[{path:'E:/work/app',name:'app',branch:'main',relPath:'.'}];
  const single=RepoBar({path:'E:/work/app',repositories:repos,onPick:()=>{}});
  assert.equal(single.type,'span');
  assert.equal(single.props.className,'ggRepoLabel');
  assert.equal(single.props.children,'app（main） · 根');
  assert.equal(single.props.title,'E:/work/app');

  let picked='';
  const many=RepoBar({path:'E:/work/app',repositories:[...repos,{path:'E:/work/lib',name:'lib',branch:'dev',relPath:'pkg'}],onPick:v=>{picked=v;}});
  assert.equal(many.type,'select');
  assert.equal(many.props.className,'ggRepoSelect');
  assert.equal(many.props.children.length,2);
  assert.ok(many.props.children.every(option=>option.type==='option'));
  assert.ok(many.props.children.every(option=>option.props.value!=='__manual__'),'不应再有手动输入路径选项');
  many.props.onChange({target:{value:'E:/work/lib'}});
  assert.equal(picked,'E:/work/lib');
});

test('多仓下拉宽度受限于左侧区域，长名称省略而不压住 Branches',()=>{
  // 之前多仓 <select> 没有样式类，宽度由最长选项撑开，溢出 .ggBarLeft 盖到 Branches 上
  assert.match(styles,/\.ggRepoSelect\{[^}]*max-width:100%/);
  assert.match(styles,/\.ggRepoSelect\{[^}]*min-width:0/);
  assert.match(styles,/\.ggRepoSelect\{[^}]*text-overflow:ellipsis/);
  assert.match(styles,/\.ggBarLeft\{[^}]*overflow:hidden/);
});

test('顶栏高度不随仓库名变长而变：名称单行省略，工具栏不换行',()=>{
  const {RepoBar}=helpers();
  const repos=[{path:'E:/work/app',name:'app',branch:'main',relPath:'.'}];
  const single=RepoBar({path:'E:/work/app',repositories:repos,onPick:()=>{}});
  // 内联样式兜底：样式表没加载对也不会换行撑高顶栏
  assert.equal(single.props.style.whiteSpace,'nowrap');
  assert.equal(single.props.style.overflow,'hidden');
  assert.equal(single.props.style.textOverflow,'ellipsis');
  assert.equal(single.props.style.minWidth,0);
  assert.equal(single.props.style.maxWidth,'100%');
  assert.match(styles,/\.ggToolbar\{[^}]*flex-wrap:nowrap/);
  assert.match(styles,/\.ggBarLeft\{[^}]*white-space:nowrap/);
  assert.match(styles,/\.ggBarCenter\{[^}]*white-space:nowrap/);
  assert.match(styles,/\.ggBarRight\{[^}]*white-space:nowrap/);
  assert.match(styles,/\.ggRepoLabel\{[^}]*max-width:100%/);
  assert.match(styles,/\.ggRepoLabel\{[^}]*white-space:nowrap/);
});

test('样式表内容变化时会覆盖旧 <style>，热更新不残留首次注入的 CSS',()=>{
  assert.match(styles,/const existing = document\.getElementById\('dshGraphStyles'\)/);
  assert.match(styles,/if \(existing\) \{[\s\S]*?textContent !== CLIENT_CSS[\s\S]*?textContent = CLIENT_CSS/);
});

test('界面语言跟随宿主：中文宿主中文，其他宿主英文',()=>{
  const commit={hash:'abc',parents:[],author:'作者',email:'a@b',date:1,message:'标题',heads:['main'],remotes:[],tags:[],stash:null,stashInternal:{selector:'stash@{0}',kind:'index'}};
  const data={commits:[commit],remotes:['origin'],head:'abc',headBranch:'main'};
  const flatten=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(flatten):[node,...flatten(node.props?.children)];
  const setup=(active)=>{
    const updates=[];
    const {GitGraphView}=helpers({useState:initial=>{let value=typeof initial==='function'?initial():initial;if(value?.commits)value=data;return [value,v=>updates.push(v)];}});
    const nodes=flatten(GitGraphView({
      sessionId:'slot',
      locale:{getLocale:()=>({active})},
      useSessions:selector=>selector({current:'old',byId:{slot:{cwd:'E:/slot'},old:{cwd:'E:/old'}}}),
    }));
    return {nodes,updates};
  };
  const zh=setup('zh');
  assert.ok(zh.nodes.some(n=>n.props?.title==='偏好'));
  assert.ok(zh.nodes.some(n=>Array.isArray(n.props?.children)&&n.props.children.includes('显示远程分支')));
  assert.ok(!zh.nodes.some(n=>n.props?.title==='Preferences'));

  const en=setup('en');
  assert.ok(en.nodes.some(n=>n.props?.title==='Preferences'));
  assert.ok(en.nodes.some(n=>n.props?.title==='Fetch'));
  assert.ok(en.nodes.some(n=>Array.isArray(n.props?.children)&&n.props.children.includes('Show remote branches')));
  assert.ok(!en.nodes.some(n=>n.props?.title==='偏好'));

  // 右键菜单、偏好菜单也要跟着切换
  const row=en.nodes.find(n=>n.type==='tr'&&typeof n.props?.onContextMenu==='function');
  row.props.onContextMenu({preventDefault(){},stopPropagation(){},clientX:5,clientY:5});
  const commitMenu=en.updates.find(v=>v?.items);
  const labels=commitMenu.items.filter(Boolean).map(i=>i.label);
  assert.ok(labels.includes('Create tag'));
  assert.ok(!labels.some(label=>/[\u4e00-\u9fff]/.test(label)));

  const prefsButton=en.nodes.find(n=>n.props?.title==='Preferences');
  prefsButton.props.onClick({preventDefault(){},stopPropagation(){},clientX:5,clientY:5});
  const prefsMenu=en.updates.filter(v=>v?.items).pop();
  const prefsLabels=prefsMenu.items.filter(Boolean);
  assert.ok(prefsLabels.some(i=>i.label==='Rounded'));
  assert.ok(prefsLabels.some(i=>i.label==='Align labels to graph'));
  assert.ok(prefsLabels.some(i=>i.label==='English'&&i.checked===true));
  assert.ok(prefsLabels.some(i=>i.label==='中文'&&i.checked===false));
});

test('主视图左上角路径默认不可编辑',()=>{
  const commit={hash:'abc',parents:[],author:'作者',email:'a@b',date:1,message:'标题',heads:['main'],remotes:[],tags:[],stash:null,stashInternal:{selector:'stash@{0}',kind:'index'}};
  const data={commits:[commit],remotes:['origin'],head:'abc',headBranch:'main'};
  const {GitGraphView,RepoBar}=helpers({useState:initial=>{let value=typeof initial==='function'?initial():initial;if(value?.commits)value=data;return [value,()=>{}];}});
  const props={sessionId:'slot',locale:{getLocale:()=>({active:'zh'})},useSessions:selector=>selector({current:'old',byId:{slot:{cwd:'E:/slot'},old:{cwd:'E:/old'}}})};
  const flatten=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(flatten):[node,...flatten(node.props?.children)];
  const left=flatten(GitGraphView(props)).find(n=>n.props?.className==='ggBarLeft');
  assert.equal(left.props.children.type,RepoBar);
  assert.equal(left.props.children.props.path,'E:/slot');
  assert.equal(left.props.children.props.onEdit,undefined);
  assert.equal(flatten(left).filter(n=>n.type==='input').length,0);
});

test('分支下拉挂在 Branches 按钮下方，不再定位到左上角',()=>{
  assert.match(view,/className: 'ggBranchAnchor'/);
  assert.match(view,/branchDropdown,/);
  assert.match(styles,/\.ggDropdown\{[^}]*top:calc\(100% \+ 4px\)[^}]*left:0/);
  assert.doesNotMatch(styles,/\.ggDropdown\{[^}]*top:40px/);
  assert.match(styles,/\.ggBranchAnchor\{[^}]*position:relative/);
});

test('表头居中显示，表体数值列仍右对齐',()=>{
  assert.match(styles,/\.ggTable th\{[^}]*text-align:center/);
  assert.doesNotMatch(styles,/\.ggTable th\{[^}]*text-align:left/);
  assert.doesNotMatch(styles,/\.ggTable th:nth-child\(n\+3\)/);
  assert.match(styles,/\.ggTable td:nth-child\(n\+3\)\{text-align:right\}/);
});

test('抓取点一下就执行，不再弹参数确认框',()=>{
  assert.match(view,/const fetchNow = async \(remoteName\) =>/);
  assert.match(view,/onClick: \(\) => fetchNow\(\)/);
  assert.match(view,/fetchNow\(name\.split\('\/'\)\[0\]\)/);
  assert.doesNotMatch(view,/act\('抓取'/);
  assert.match(view,/\['prune', L\('抓取时清理失效引用'/);
  assert.match(bundle,/const fetchNow/);
  assert.doesNotMatch(bundle,/act\('抓取'/);
});

test('仓库发现 / 独立分支列表 / tooltip 实测定位 / 刷新失效均接线到位',()=>{
  assert.match(view,/gitCall\('listRepos', \{ path: sessionCwd \}, L\)/);
  assert.match(view,/repoRequest\.current/);
  assert.match(view,/call\('branches'\)/);
  assert.match(view,/本地分支/);assert.match(view,/远程分支/);
  assert.match(view,/tooltipRef\.current/);
  assert.match(view,/window\.innerWidth - rect\.width - margin/);
  assert.match(view,/skipDetailRefresh\.current/);
  assert.match(diff,/\[hasRows\]/);
});
test('严格构建拒绝非法模块语法且不覆盖产物',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'graph-build-'));
  try{
    for(const folder of ['scripts','src','lib'])await mkdir(join(dir,folder));
    await copyFile(new URL('scripts/build.mjs',root),join(dir,'scripts','build.mjs'));
    for(const name of sourceNames)await copyFile(new URL('src/'+name+'.js',root),join(dir,'src',name+'.js'));
    const run=()=>spawnSync(process.execPath,[join(dir,'scripts','build.mjs')],{encoding:'utf8'});
    assert.equal(run().status,0);
    const before=await readFile(join(dir,'lib','client.js'),'utf8');
    for(const invalid of ['import x from "x";','export default 1;','export { x };','const x = 1; export const y = 2;']){
      await writeFile(join(dir,'src','diff.js'),invalid);
      assert.notEqual(run().status,0,invalid);
      assert.equal(await readFile(join(dir,'lib','client.js'),'utf8'),before);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('diff 按文件、hunk 与增删行号解析，忽略无换行标记',()=>{
  const {parseDiffText}=helpers();
  const parsed=parseDiffText('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -2,2 +2,2 @@\n-old\n+new\n same\n\\ No newline at end of file\ndiff --git a/b b/b\nBinary files a/b and b/b differ\n');
  assert.equal(parsed.length,2);assert.equal(parsed[0].hunks.length,1);
  assert.deepEqual(parsed[0].hunks[0].lines.slice(1).map(l=>[l.t,l.oldLn,l.newLn]),[['del',2,null],['add',null,2],['ctx',3,3]]);
  assert.match(parsed[1].meta[0],/Binary files/);
});
test('空和非空 diff 的 Hook 数量一致，长 diff 仅渲染窗口',()=>{
  let count=0;
  const react=Object.fromEntries(['useMemo','useRef','useState','useLayoutEffect'].map(name=>[name,(...args)=>{count++;if(name==='useMemo')return args[0]();if(name==='useRef')return {current:null};if(name==='useState')return [0,()=>{}];}]));
  const {DiffView}=helpers(react);
  DiffView({text:''});const emptyCount=count;count=0;
  const node=DiffView({text:'diff --git a/a b/a\n@@ -1 +1,10000 @@\n'+Array(10000).fill('+hello').join('\n')});
  assert.equal(count,emptyCount);assert.ok(node.props.children.props.children.length<100);
});
test('提交详情不再重复放关闭按钮',()=>{
  const {CommitDetails}=helpers();
  const node=CommitDetails({details:{direction:null,commit:{hash:'abc',author:'a',email:'e',committer:'c',date:1,parents:[],message:'m'},files:[]},measure:()=>{},openFile:()=>{},tree:true,setTree:()=>{}});
  const flatten=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(flatten):[n,...flatten(n.props?.children)];
  assert.equal(flatten(node).filter(n=>n.props?.children==='关闭').length,0);
});
test('模态遮罩包含对话框与表单，支持四种字段',()=>{
  const {FormDialog}=helpers();
  const node=FormDialog({form:{title:'测试',message:'说明',fields:['text','checkbox','radio','select'].map(type=>({name:type,type,options:['a','b']})),submitLabel:'执行',onSubmit:()=>{}},close:()=>{}});
  assert.equal(node.props.className,'ggMask');assert.equal(node.props.children.type,'form');assert.equal(node.props.children.props.role,'dialog');assert.equal(typeof node.props.children.props.onSubmit,'function');
});
test('Git 原始错误保留',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>({json:async()=>({ok:false,error:{message:'fatal: 本地修改会被覆盖\n详细原因'}})});
  try{await assert.rejects(helpers().gitCall('merge',{path:'x'}),{message:'fatal: 本地修改会被覆盖\n详细原因'});}finally{globalThis.fetch=original;}
});

test('新建文件与以多个加减号开头的内容保持正确行号',()=>{
  const files=helpers().parseDiffText('diff --git a/new b/new\r\n--- /dev/null\r\n+++ b/new\r\n@@ -0,0 +1,2 @@\r\n+++content\r\n+tail\r\n');
  assert.equal(files[0].oldName,'/dev/null');assert.equal(files[0].newName,'new');
  assert.deepEqual(files[0].hunks[0].lines.slice(1).map(l=>[l.t,l.newLn]),[['add',1],['add',2]]);
});



test('主视图渲染完整表格并优先选择 slot 会话，推送保留远端数组',async()=>{
  const commit={hash:'abc',parents:[],author:'作者',email:'a@b',date:1,message:'标题',heads:['main'],remotes:[],tags:[],stash:null,stashInternal:{selector:'stash@{0}',kind:'index'}};
  const data={commits:[commit],remotes:['origin'],head:'abc',headBranch:'main'};
  const updates=[];
  const {GitGraphView}=helpers({useState:initial=>{let value=typeof initial==='function'?initial():initial;if(value?.commits)value=data;return [value,v=>updates.push(v)];}});
  let cwd;
  const props={sessionId:'slot',locale:{getLocale:()=>({active:'zh'})},useSessions:selector=>{cwd=selector({current:'old',byId:{slot:{cwd:'E:/slot'},old:{cwd:'E:/old'}}});return cwd;}};
  const rendered=GitGraphView(props);
  const flatten=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(flatten):[node,...flatten(node.props?.children)];
  const nodes=flatten(rendered);
  assert.equal(cwd,'E:/slot');
  assert.deepEqual(nodes.filter(n=>n.type==='th').map(n=>n.props.children),['Graph','Description','Date','Author','Commit']);
  assert.equal(nodes.filter(n=>n.type==='svg'&&n.props.className==='ggSVG').length,1);
  const stashBadge=nodes.find(n=>n.props?.className==='gitRef stashIntern');
  assert.ok(stashBadge,'stash 内部提交要有专属徽标');
  assert.match(stashBadge.props.children[1].props.children,/stash@\{0\} · 索引/);
  assert.ok(nodes.some(n=>n.type==='tr'&&String(n.props?.className).includes('ggStashInternal')),'行上要有 stashIntern 样式类');
  const badge=nodes.find(n=>n.props?.className?.includes('gitRef head'));
  badge.props.onContextMenu({preventDefault(){},stopPropagation(){},clientX:10,clientY:20});
  const menu=updates.find(v=>v?.items);
  menu.items.find(v=>v?.label==='推送').action();
  const form=updates.find(v=>v?.title==='推送分支');
  const original=globalThis.fetch;const sent=[];
  globalThis.fetch=async(_,options)=>{const payload=JSON.parse(options.body);sent.push(payload);return {json:async()=>({ok:true,value:payload.op==='graph'?data:{stdout:'',stderr:''}})};};
  try{await form.onSubmit({'remote:origin':true,setUpstream:true,mode:'force-with-lease'});assert.deepEqual(sent[0],{op:'pushBranch',path:'E:/slot',branch:'main',remotes:['origin'],setUpstream:true,mode:'force-with-lease'});}finally{globalThis.fetch=original;}
});

test('tooltipPills 对空列表返回数组（tooltip 里是展开运算，返回单个元素会崩）', () => {
  const { tooltipPills } = helpers();
  const empty = tooltipPills([]);
  assert.ok(Array.isArray(empty), '空列表必须返回数组，否则悬停无引用的提交会抛 TypeError');
  assert.equal(empty.length, 1, '空列表要渲染一个「无」占位');
  assert.equal(tooltipPills(['main', 'v1.0']).length, 2);
});
