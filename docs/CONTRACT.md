# DSH Git Graph —— 实现契约（架构师维护）

本文件是唯一权威规格。开发子代理按本文件实现，不得自行改变契约；发现契约有问题，
在回复里提出，由架构师改本文件。

参考源码已读，关键文件：`web/graph.ts`（布局算法）、`web/main.ts`（表格/菜单/详情视图）、
`web/styles/main.css`（视觉常量）、`src/config.ts`（默认色板与网格）。

## 0. 仓库现状

| 路径 | 说明 | 归属 |
|---|---|---|
| `lib/index.js` | 宿主半：`POST /vsc-git-graph`，约 35 个 op | 宿主代理 |
| `src/graph.js` | **已完成**的布局引擎（纯函数，已测） | 架构师，勿改 |
| `test/graph.test.js` | 引擎单测（14 项） | 架构师，勿改 |
| `vendor/legacy-client-bundle.js` | 旧客户端产物（含虚拟滚动 DiffView 可参考） | 只读参考 |
| `test/parse.test.js` / `test/integration.test.js` | 宿主纯函数 / HTTP 端到端 | 勿改 |

约定：ES modules、Node ≥ 20、**不新增任何依赖**、注释与文案用中文、测试用 `node --test`。
禁止 `git commit` / `git push`（由架构师统一提交）。禁止修改他人归属文件。

## 1. 宿主契约（`lib/index.js`）

所有 op 走同一入口：`POST /vsc-git-graph`，body `{ op, path, ... }`，
返回 `{ ok:true, value }` 或 `{ ok:false, error:{ code, message } }`。
**既有 op 全部保持不变**（向后兼容），只新增下列 op。

### 1.1 `graph`（新增，客户端主数据源）

```
payload: {
  path: string,
  maxCommits?: number = 300,
  skip?: number = 0,
  order?: 'date' | 'author-date' | 'topo' = 'date',
  branches?: string[] | null = null,   // null = 显示全部分支
  showRemote?: boolean = true,
  hideRemotes?: string[] = [],
  showStashes?: boolean = true,
  showUncommitted?: boolean = true,
  firstParentOnly?: boolean = false
}
value: {
  commits: [{
    hash: string, parents: string[],
    author: string, email: string, date: number,          // Unix 秒
    committer: string, committerEmail: string, commitDate: number,
    message: string,                                      // 完整 message，> 4000 字符截断
    heads: string[],                                      // 本地分支短名
    remotes: [{ name: string, remote: string }],          // name = "origin/main"
    tags: [{ name: string, annotated: boolean }],
    stash: null | { selector: string, baseHash: string },
    stashInternal: null | { selector: string, kind: 'index' | 'untracked' | 'internal' }
  }],
  head: string | null,                                    // HEAD 的完整 hash
  headBranch: string | null,                              // 游离时为 null
  remotes: string[],                                      // 远端名列表
  tags: string[],                                         // 标签名列表
  moreAvailable: boolean
}
```

实现要求：

- 取提交：一次 `git log`，`--skip=<skip> --max-count=<maxCommits+1>`，
  排序 `--date-order` / `--author-date-order` / `--topo-order`，
  `firstParentOnly` 追加 `--first-parent`。
  `--format` 用 `%x1e` 作记录分隔、`%x1f` 作字段分隔：
  `%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%B%x1e`。
  按 `\x1e` 切记录、去掉记录首部换行、按 `\x1f` 切字段；字段数 > 10 时把尾部重新拼回
  message（message 里可能含分隔符）。`%D` 只用于兜底，refs 以 1.1 的 ref 表为准。
- 版本选择：`branches === null` → `--all`，否则把数组里每个名字作为 revision 传入。
  `showStashes === false` 时在 `--all` 之前加 `--exclude=refs/stash`：只把 stash 排除出
  起点，不影响它的祖先；不能用 `--not refs/stash`，stash 的父提交是 HEAD，会按可达性把
  整段历史一并排除。
  `showRemote === false` / `hideRemotes` 只过滤输出里的 `commits[].remotes` 标签，不参与
  revision 选择：`--not refs/remotes/*` 是按可达性排除，远端分支落在旧提交时会把与远端
  共享的历史整段删掉（表现为「取消显示远程分支后历史消失」）。顶层 `remotes` 远端名保留。
- ref 表：`git for-each-ref --format=%(refname)%09%(objecttype)%09%(objectname)%09%(*objectname) refs/heads refs/remotes refs/tags`，
  一个 hash 可能对应多个 ref，逐条累加。`refs/heads/x` → `heads`；
  `refs/remotes/<remote>/<rest>` → `remotes:{name:"<remote>/<rest>", remote}`（跳过 `<remote>/HEAD`）；
  `refs/tags/t` → `tags:{name:"t", annotated: objecttype==='tag'}`，annotated 的提交 hash 用
  `*objectname`（peeled）。`remotes` / `tags` 的顶层数组由 ref 表去重得出。
- `head`：`git rev-parse HEAD`；`headBranch`：`git symbolic-ref -q --short HEAD`（失败 = null）。
- stash：`git stash list --format=%gd%x09%H`，selector 形如 `stash@{0}`；
  `baseHash` 取该提交的第一父（不在窗口内则空串）。窗口内同 hash 的提交标 `stash`。
  另用一次 `git rev-list --no-walk --parents <stash...>` 找出每个 stash 的第 2/3 个父提交
  （stash 内部的 index / untracked 提交），窗口内的标 `stashInternal:{selector,kind}`；
  已挂在真实分支/标签/远端上的提交不标。它们仍然作为普通行返回（保留可查看/可复制），
  只是客户端图谱用灰色虚线绘制。
- 未提交改动：`showUncommitted !== false` 且 `git status --porcelain` 非空且存在 HEAD 时，
  在数组**最前面**插入伪提交：`hash:"UNCOMMITTED"`、`parents:[head]`、
  `message:"未提交的改动"`、`author:"*"`、`email:""`、`date:<当前秒>`、其余为空/null。
- `moreAvailable`：申请了 `maxCommits+1` 条，多出来的那条丢掉并置 true。
- 安全：所有 ref/branch/file 名必须走 `requireRef`（非空、不以 `-` 开头、不含空白与控制字符），
  避免被当成 git 选项注入。

### 1.2 `commitDetails`

```
payload: { path, hash }                       // hash 可为 "UNCOMMITTED"
value: {
  commit: <同 1.1 commits 项>,
  files: [{ status:'M'|'A'|'D'|'R'|'C'|'T'|'?', path, oldPath, additions, deletions, binary }]
}
```

- 元数据：`git show -s --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B%x1f <hash>`；
  refs 复用 1.1 的 ref 表逻辑（同 hash）。
- 文件：`git diff-tree --root --no-commit-id -r -M --name-status -z <hash>` 与
  `--numstat -z <hash>` 合并；numstat 的 `-` 表示二进制。根提交必须能列出（`--root`）。
- `UNCOMMITTED`：文件来自 `git status --porcelain`（重命名取 `->` 两侧），
  additions/deletions 由 `git diff --numstat` 与 `git diff --cached --numstat` 合并，取不到的算 0。

### 1.3 `compare`

`payload: { path, a, b }`（a/b 可为 `"UNCOMMITTED"` → 用工作区对比）→
`value: { files: <同 1.2 files> }`，实现用 `git diff [-M] --name-status -z` + `--numstat -z`。

### 1.4 `fileDiff`

`payload: { path, hash?, file, staged? }` → `value: { text, truncated }`。
`hash` 缺省或为 `UNCOMMITTED` → `git diff [--cached] -- <file>`；否则
`git show --format= <hash> -- <file>`。保留既有 2MB 截断语义（`truncated`）。

### 1.5 新增动作 op

全部返回 `{ ok:true, value:{ stdout, stderr } }` 或 `{ ok:false, error:{code:'git-error', message} }`，
失败时 message 必须是 git 的原始 stderr（用户要看到真实原因，如「本地改动会被覆盖」）。

| op | 参数 | git 命令要点 |
|---|---|---|
| `checkoutCommit` | `hash` | `switch --detach <hash>` |
| `checkoutBranch` | `name`, `remoteBranch?` | 无 remoteBranch → `switch -- <name>`；有 → `switch -c <name> --track <remoteBranch>` |
| `createBranch` | `name`, `hash`, `checkout`, `force` | `branch [-f] <name> <hash>`，checkout 时改用 `switch -c <name> <hash>` |
| `deleteBranch` | `name`, `force`, `remotes?[]` | 本地 `branch -d/-D`；remotes 里每个执行 `push <remote> --delete <name>` |
| `renameBranch` | `oldName`, `name` | `branch -m <old> <new>`（既有 op 已有，可复用） |
| `merge` | `name`, `noFf`, `squash`, `noCommit` | `merge [--no-ff] [--squash] [--no-commit] <name>`（既有 op 扩展） |
| `rebase` | `on`, `ignoreDate` | `rebase [--ignore-date] <on>` |
| `resetToCommit` | `hash`, `mode` | `reset --soft\|--mixed\|--hard <hash>` |
| `cherryPick` | `hash`, `parent?`, `recordOrigin`, `noCommit` | `cherry-pick [-m <parent>] [-x] [-n] <hash>` |
| `revert` | `hash`, `parent?` | `revert [--no-edit] [-m <parent>] <hash>` |
| `stashPush` | `includeUntracked`, `message?` | `stash push [-u] [-m <message>]` |
| `stashList` | — | `stash list --format=%gd%x09%H%x09%gs` |
| `stashApply` / `stashPop` | `ref`, `reinstateIndex` | `stash apply\|pop [--index] <ref>` |
| `stashDrop` | `ref` | `stash drop <ref>` |
| `tagAdd` | `name`, `hash`, `annotated`, `message?`, `force`, `pushRemote?` | `tag [-f] [-a -m <msg>] <name> <hash>`，pushRemote 时再 `push <remote> <name>` |
| `tagDelete` | `name`, `remote?` | `tag -d <name>`；remote 时 `push <remote> --delete refs/tags/<name>` |
| `fetch` | `prune`, `pruneTags`, `remote?` | `fetch [--prune] [--prune-tags] [<remote>]`（既有 op 扩展） |
| `pushBranch` | `branch`, `remotes?[]`, `setUpstream`, `mode` | `push [-u] [--force-with-lease\|--force] <remote> <branch>`，多 remote 逐个执行 |
| `pullBranch` | `branch`, `rebase`, `ffOnly`, `squash`, `noCommit` | `pull [--rebase] [--ff-only] [--squash] [--no-commit]` |
| `clean` | `includeUntracked`, `force` | `clean -fd [-x]`（`-x` 仅在 includeUntracked 且 force） |

统一超时：读操作 60s，网络操作（fetch/push/pull）120s。

### 1.6 测试（宿主代理负责 `test/host-graph.test.js`）

用 `mkdtemp` 造真实仓库（`git init`、几次提交、一个分支、一个合并、一个 tag、一个 stash），
断言：`graph` 的 commits/parents/refs 归属正确、`moreAvailable` 分页正确、
`UNCOMMITTED` 只在脏工作区出现、`commitDetails` 能列出根提交文件、
`compare` 能比较两次提交、`fileDiff` 对工作区与历史都正确、选项注入被拒绝。
跑 `node --test test/host-graph.test.js test/parse.test.js test/integration.test.js` 必须全绿。

## 2. 客户端结构（客户端代理）

客户端是**单文件产物**，由 `node scripts/build.mjs` 生成 `lib/client.js`。
运行时只有 `require(...)`（`window.__ModuleLoader__`）。因此：

- 源码按 ESM 写（`export function x` / `export class X` / `export const x`），
  **不得有 `import`**，不得有 `export default`，不得用 JSX 语法。
- `scripts/build.mjs` 依次读取 `src/graph.js`、`src/diff.js`、`src/styles.js`、`src/view.js`、`src/module.js`，
  把 `export ` 前缀剥掉后按顺序内联进 factory，外面包：
  ```js
  (() => {
    window.__ModuleLoader__.load({
      id: "dsh-vsc-git-graph",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
        /* …内联源码… */
        return module.exports;
      },
    });
  })();
  ```
  剥离必须**严格**：只允许匹配行首（允许缩进）的 `export `，若源码里出现其余 `export`/`import`
  形式，构建脚本必须报错退出（防止静默产出坏包）。
- `src/module.js` 末尾设置 `exports.apply = apply; exports.inject = ["slots"];`
- 组件里用 `const { jsx, jsxs, Fragment } = require("react/jsx-runtime");`（或 `react.createElement`），
  `require("react")`、`require("react-dom")` 可用。

### 运行时兼容红线（旧补丁修过的坑，重建时必须保留）

1. 会话工作目录：`const sessionCwd = props.useSessions((s) => { const cur = props.sessionId || s.current; … })`
   —— dsh 0.1.6-alpha.2 起 sessions store 没有 `current`，必须优先用 slot 传入的 `sessionId`。
2. 图标：primitives 的分支图标改过名，必须回退解析
   `primitives.IconBranchOutline16 || IconBranchOutlineRegular || IconBranchOutlineMedium || (() => null)`；
   其余图标一律用内联 SVG（免疫改名）。除 `primitives.Button` 外不要直接使用 primitives 组件。
3. 触发注册：`ctx.slots.inject("conversation.view", () => ctx.slots.register({ name:"conversation.view", id:"vsc-git-graph", order:21, label: () => "Git Graph", inject: () => ({}) }, GitGraphView))`。

## 3. 视觉规格（客户端代理必须逐项对齐）

网格 `{x:16, y:24, offsetX:16, offsetY:12, expandY:250}`；色板用 `DEFAULT_COLOURS`（12 色）。
主视图 = **一整页表格**，不是三栏。

- 列：`Graph | Description | Date | Author | Commit`；表头 `padding:6px 12px; line-height:18px`，
  行高 24、字号 13、单元格 `padding:0 4px`。Date/Author/Commit 可隐藏（表头右键菜单）。
- 行：`<tr class="commit [current] [mute] [commitDetailsOpen]" data-id data-color>`；
  hover `rgba(128,128,128,.15)`，详情展开 `.25`，变灰 `opacity:.5`，current 描述加粗。
- 描述列：`HEAD` 圆点（6×6、2px 描边、`margin-top:7px`）→ 引用胶囊 → 提交标题（省略号）。
- 引用胶囊 `.gitRef`：高 18、圆角 5、`1px rgba(128,128,128,.75)` 边框、`rgba(128,128,128,.15)` 底、
  字号 12、`margin:2px 5px 0 0`；图标 14×14 用该行 `data-color` 填充、图形用背景色；
  当前分支 `active` 用该行颜色描边加粗；远程分支可与本地分支合并显示（`.gitRefHeadRemote` 斜体分隔）；
  类型：`head` / `remote` / `tag` / `stash`。
- 图谱：单个绝对定位 `<svg>`，`left:0; top:表头高; width:model.width; height:model.height`，
  `pointer-events:none`，只有圆圈 `pointer-events:all`；
  每条路径先画 `.shadow`（`var(--dsw-alias-bg-base)`、宽 4、不透明度 .75）再画 `.line`（宽 2）；
  圆点 r=4、`current` 用背景填充 + 2px 彩色描边；stash 额外画 r=2 内圈；
  超过列宽上限时用 `linear-gradient` 遮罩淡出（`maxWidth`）。
- 悬停 tooltip：延迟 100ms；内容 = `提交 <短哈希>` / `该提交 (未)包含在 HEAD 中` /
  `分支：<胶囊列表>` / `标签：…` / `stash：…`；指向圆点的 30×2 彩色横条；
  内容框 2px 彩色边框、圆角 5、字号 13/22；出现时圆圈 r→5、对应行加 `graphVertexActive`。
- stash 内部提交（`stashInternal`）：行保留，但图谱走**灰色虚线**、不占用普通色板槽
  （否则后续真实分支会复用同色，看起来像同一泳道断成两截）；行内给一个虚线灰色徽标
  `stash@{0} · 索引/未跟踪`，提示它只属于 stash。
- 内嵌提交详情（默认）：选中行正下方插入 `<tr class="cdvRow"><td colspan=N>`，
  **高度必须量出来回填给引擎的 `expandY`**，再重算图谱（这是参考实现的做法，否则线会错位）；
  左右两半：左=摘要（作者/提交者/日期/父提交/完整 message），右=变更文件（树/列表可切换，
  文件夹可折叠，状态字母按 M/A/D 上色，带 +n/-n）。关闭靠再次点击该行或 Esc，不设关闭按钮。
- diff 抽屉：默认不占版面；点击详情里的文件时从底部展开（高度可拖拽 200px–70vh），
  顶部显示路径 + 对比方向 + 关闭；内容复用 `DiffView`（按文件分组、行号、增删底色、虚拟滚动）。
- 控制条：仓库下拉（多仓时）、分支下拉（多选、含「显示全部」、可搜索）、
  「显示远程分支」勾选框、右侧：查找 / 刷新 / 抓取 图标按钮 + 一个齿轮菜单
  （圆角/直角、标签对齐图谱、只跟随第一父、提交排序、变灰合并提交、中文/English）。
- 仓库下拉的候选 = 会话目录本身（若是仓库）+ 扫描到的**嵌套仓库 / submodule**。
  `git worktree` 是某个分支的工作目录，**不算仓库**，不进下拉（`worktree.role=linked`
  的条目在宿主端就被剔除；根条目恒为 `main`，即使根本身就是一个 linked worktree）。
- 语言：首次启动读宿主 locale 快照（`zh` → 中文，其他 → 英文，缺失时退回
  `navigator.language`）；宿主偏好异步到达时，在用户手动选择前持续跟随。手动选择写入
  `localStorage["dshGitGraph.lang"]`，之后不再被宿主语言覆盖。
- 底部：`加载更多提交` 按钮；滚到底部 25px 内自动加载。
- 右键菜单：分组、组间分隔线、支持 `checked` 与禁用；键盘 Esc 关闭；超出视口要夹取。
- 对话框：居中模态，标题 + 说明 + 表单（文本 / 复选框 / 单选 / 下拉）+ 主次按钮；Enter 提交、Esc 关闭。

## 4. 交互清单（对齐 VS Code Git Graph）

- 点击提交行 → 展开/收起内嵌详情；`Ctrl/⌘+点击` → 两个提交对比（`compare`）。
- 双击本地分支胶囊 → 切换（`checkoutBranch`）；双击远程分支胶囊 → 建本地跟踪分支。
- 右键分支胶囊：切换 / 重命名 / 删除（可选强制、可选删远端）/ 合并到当前分支 / 变基 /
  推送（可选 remote、set-upstream、normal·force-with-lease·force）/ 在分支下拉中选中·取消 / 复制名字。
- 右键提交行：打标签 / 建分支 / 检出（游离）/ 摘取（cherry-pick）/ 撤销（revert）/ 丢弃（drop）/
  合并 / 变基 / 重置（soft·mixed·hard）/ 复制哈希 / 复制标题。
- 右键远程分支：切换（建跟踪）/ 删除远端 / 抓取该远端 / 合并 / 拉取 / 复制名字。
- 右键标签：查看详情 / 删除（本地或远端）/ 推送 / 复制名字。
- 右键 stash：应用 / 弹出 / 删除 / 建分支 / 复制名字·哈希。
- 右键「未提交的改动」行：暂存（stash，含未跟踪）/ 重置（mixed·hard）/ 清理未跟踪 / 查看变更文件。
- 键盘：`Esc` 依序关闭（菜单→对话框→下拉→查找→详情）；`Ctrl/⌘+F` 查找、`Ctrl/⌘+R` 刷新、
  `Ctrl/⌘+H` 跳到 HEAD；详情展开时 `↑/↓` 上下移动、`Ctrl+↑/↓` 走同分支首父/首子、
  `Ctrl+Shift+↑/↓` 走另一父/子（用引擎的 first/alternative 索引）。
- 查找：输入即过滤高亮、当前匹配行 `findCurrentCommit` + 闪烁动画、显示 `第 n / 共 m 个`。
- 所有失败信息用对话框或行内错误条显示 git 原文，不得静默。

## 5. 验收

- 客户端：`node scripts/build.mjs` 成功；`node --test test/graph.test.js test/client-source.test.js` 全绿；
  生成物 `lib/client.js` 能被 `node -e "new Function(require('node:fs').readFileSync('lib/client.js','utf8'))"` 解析。
- 宿主：`node --test test/host-graph.test.js test/parse.test.js test/integration.test.js` 全绿。
- 全量：`npm test` 全绿（架构师最终跑）。

---

## 6. 补充修订（Amendment A）—— 以本节为准，覆盖前文冲突处

### 6.1 路径与引用校验拆分

- **引用类**（分支名、tag 名、远端名、stash ref、hash）：`requireRef` —— 非空、不以 `-` 开头、
  不含空白与控制字符。
- **文件路径类**（`file`、`oldPath` 等）：`requireFilePath` —— 非空、不含 NUL/控制字符、
  **允许空格与中文**、不以 `-` 开头；命令里必须用 `--` 与其它参数隔开。
  之前把 `file` 也塞进 `requireRef` 是错的中等 bug，必须改。

### 6.2 `fileDiff` 支持两提交对比

```
payload: { path, hash?, file, staged?, a?, b? }
```
- 有 `a`/`b` → `git diff <a> <b> -- <file>`（a/b 可为 "UNCOMMITTED" → 用工作区一侧）。
- 否则沿用原语义（`hash` 缺省/UNCOMMITTED → 工作区；`staged` → `--cached`）。

### 6.3 `pullBranch` 明确远端语义

```
payload: { path, branch, remote?, remoteRef?, rebase?, ffOnly?, squash?, noCommit? }
```
- 有 `remote` + `remoteRef` → `git pull <remote> <remoteRef>`（拉的是**指定远程分支**，
- 只有 `branch` → `git pull <remote=origin 或该分支的 upstream 远端> <branch>`。
- `rebase` → `--rebase`；`ffOnly` → `--ff-only`；`squash` → `--squash`；`noCommit` → `--no-commit`。
- 校验：`remote`/`remoteRef`/`branch` 全部走 `requireRef`；`remote` 必须在 `git remote` 列表中。

### 6.4 新增 `dropCommit`

```
payload: { path, hash }
```
等价于「把该提交从当前分支上摘掉，并把它的后代接到它的第一父上」：
`git rebase --onto <hash>^ <hash> <currentBranch>`（`hash` 无父时报错）。
失败时原样返回 stderr（例如有冲突），成功后前端刷新即可。
客户端必须先用引擎的 `dropCommitPossible(i)` 判断可行性，不可行时菜单项禁用。

### 6.5 UI 以参考截图为基准（覆盖第 3 节冲突处）

1. 顶栏：居中显示 `Branches:` 标签 + 分支下拉（多选，含「显示全部 / Show All」）+
   `显示远程分支` 勾选框；右侧一组图标按钮依次为 查找、终端（本插件不实现终端，可省略）、
   设置、刷新、抓取。左右布局用 `flex`，中间分组居中，图标靠右。
2. 表格列：`Graph | Description | Date | Author | Commit`，Date/Author/Commit 右对齐；
   表头底部 1px 分隔线；Graph 列宽约 160px，随图谱内容自适应。
3. 日期格式：`10 Nov 2026 21:14`（`DD Mon YYYY HH:mm`，英文月份缩写，本地时区）。
4. 引用胶囊：左侧 14×14 图标块用该行图谱颜色填充，图标本身用背景色；胶囊内名称 12px；
   当前分支名加粗；远程分支胶囊用同款结构、稍暗。
5. **默认开启「非 HEAD 祖先的提交变灰」**（截图里大量灰色行即此效果），
   齿轮菜单里可关；合并提交默认也变灰。
6. 行高 24，字号 13；行 hover `rgba(128,128,128,.15)`；变灰行文字 `opacity:.5`。

### 6.6 详情与首屏体感（实测数据）

- `commitDetails` **不解析 ref**（heads/remotes/tags 一律返回空数组）：客户端已从 `graph` 拿到，
  详情里再跑一次 `for-each-ref` 只是多一次进程 spawn。需要 ref 时用 `graph`。
- `changedFiles` 的 `--name-status` 与 `--numstat` 两次 git 调用必须**并行**。
- 客户端必须「点击即展开」：先用行数据（graph 已含作者/日期/父提交/完整信息）渲染详情骨架，
  文件列表用「正在读取变更文件…」占位，响应回来再补；并做 hash → 详情的缓存，刷新/切仓时清空。
  本机实测 `commitDetails` 从 p50 253ms 降到 p50 118ms，配合骨架用户不再感知点击延迟。
