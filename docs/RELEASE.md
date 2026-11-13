# 打包与发布指南

本文件是发布操作手册（未提交，供你审阅后执行）。仓库当前状态：`main` = `origin/main` = `75e2eba`，
工作区干净（除本文件与两个未跟踪的 obsidian 对比图）。

---

## 0. 先确认的三件事

| 项 | 现状 | 结论 |
|---|---|---|
| npm 包名 `dsh-vsc-git-graph` | `registry.npmjs.org` 返回 404 | **可用**，无需改名 |
| `npm pack` 产物 | 11 个文件、58KB（lib + 补丁 + 许可 + 说明） | 体积正常 |
| GitHub 仓库年龄 | 创建于 2026-11-13T11:46Z（今天） | 市场收录要求「仓库 ≥ 1 天」，**明天再提 PR** |

---

## 1. 发布前必须改 `package.json`

当前文件有 4 个问题会挡住发布：

| 问题 | 现状 | 改法 |
|---|---|---|
| `private: true` | 阻止 `npm publish` | **删除**这一行 |
| 缺 `repository` | 市场靠它把 npm 包映射回 GitHub（显示 star、读清单） | 加 `"repository": { "type": "git", "url": "git+https://github.com/Si-xiyu/dsh-git-graph.git" }` |
| 缺 `homepage` / `bugs` | 可选但建议 | 分别指向仓库与 issues |
| 缺 `engines.dsh` | 市场兼容性筛选读它（或读同版本线 `@deepseek-ai/dsh-*` peer 范围） | 加 `"dsh": ">=0.1.0-rc.5"` 到 `engines` |

另外建议（非阻塞）：

- `peerDependencies` 里三个 `@deepseek-ai/dsh-client-*` 保持 `"*"`：**不要**改成 `>=0.1.0-rc.5`
  这类范围——npm 的语义是「范围里带 prerelease 时，只匹配同一 major.minor.patch 元组」，
  写成 `>=0.1.0-rc.5` 反而会把 0.2.x-rc 的宿主排除掉。兼容性信息由 `engines.dsh` 承担。
- `dshhub` 字段不是当前市场流程的一部分（市场条目在 awesome-dsh-plugin 的 YAML 里，
  兼容性读 `engines.dsh`/peerDeps）。留着无害，但别指望它上架。
- `keywords` 已删掉与现状不符的 `file-browser`、`code-editor`（文件页签已移除）；
  `i18n`/`bilingual`/`zh`/`en` 保留——界面确实是双语的：
  初次启动跟随宿主语言（`detectLang`，中文 → zh，其他 → en），
  设置菜单里可手动切换（English / 中文），选择存在 `localStorage['dshGitGraph.lang']`。

改完自查：

```powershell
node -e "const p=require('./package.json');console.log(p.private, p.repository?.url, p.engines)"
npm pack --dry-run        # 仍应是 11 个文件
npm test                  # 135 通过 / 2 跳过
```

---

## 2. 发布到 npm

```powershell
npm login                     # 浏览器授权，账号 Si-xiyu
npm whoami                    # 确认登录
npm publish --access public   # 包名未 scoped，默认 public；prepublishOnly 会先跑测试
```

发布后验证：

```powershell
npm view dsh-vsc-git-graph version dist.tarball
npx -y dsh-vsc-git-graph --help   # 无 CLI，会失败；这一步跳过
```

更实用的验证是装进一个临时 profile：

```powershell
& 'D:\Software\Deepseek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add dsh-vsc-git-graph
```

> 注意：本机 `desktop` profile 现在是 `link:E:\Code\dsh-vsc-git-graph`。要验证 npm 包，
> 先 `plugin remove` 再 `add dsh-vsc-git-graph`，否则装的还是本地目录。

后续发版：`npm version patch|minor` → `git push --follow-tags` → `npm publish`。

---

## 3. 上架 DSH 插件市场

市场的插件列表来自精选仓库 **[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**
（dshmarket.com / awesome-dsh-plugin.com / 市场发现页都从它生成）。**不是提交到 dshmarket 仓库。**

### 3.1 提交内容：一个 YAML 文件

PR 新增 `data/plugins/Si-xiyu__dsh-git-graph.yml`：

```yaml
url: https://github.com/Si-xiyu/dsh-git-graph
name: Si-xiyu/dsh-git-graph
category: git
description:
  en: 'Git Graph for DeepSeek Harness: a VS Code-style commit graph with branch switching, merge, rebase, tags, stash and inline diffs.'
  zh: 'DeepSeek Harness 的 Git 图谱：VS Code 风格的提交图，支持切换分支、合并、变基、标签、stash 与内嵌差异。'
# 可选：GitHub 托管的位图，作为市场卡片图标（不写则用作者头像）
# icon: https://raw.githubusercontent.com/Si-xiyu/dsh-git-graph/main/docs/assets/icon-180.png
```

要点：

- `description.en` 必填；含 `: ` 必须用引号包住（上面的 `en` 已加）。
- `category` 取值里 `git` 合法。
- **README 不要手改**：两个 README 由 `data/plugins/*.yml` 生成。
- 一个文件就是全部投稿，不会和别人冲突。

### 3.2 收录要求（逐条对照）

| 要求 | 我们 |
|---|---|
| `package.json` 声明 `dsh.bundle` manifest | ✅ `dsh.bundle.patch = ./cordis.patch.yml` |
| 仓库 ≥ 1 天 | ❌ 今天才建，**明天再提** |
| `description` 与实际功能一致 | ✅（提交前再核一遍） |
| `repository` 指向本仓库 | ❌ 需按第 1 节补 |
| 被积极维护 | ✅ |
| 建议加 `dsh-plugin` topic（不限大小写） | ❌ 需在仓库设置里加 |

可选加分项（都能提升市场卡片质量）：

- `screenshots.json`（最多 6 张，放在仓库里，字段见贡献指南）；
- `icon`（180×180 PNG，GitHub 托管）；
- 发 GitHub Release 并在 YAML 里用 `tarball:` 固定安装包（无 npm 时的回退安装路径）。

### 3.3 提 PR

```powershell
# fork 后在 data/plugins/ 下加那个 yml，提交 PR 即可
```

PR 合并后，站点与市场通常 **1 天内**自动收录（CI 每日重建索引）。

---

## 4. 发布后重写 README（结构与要点）

现在 README 只有 40 行、偏「开发说明」。发布版建议按下面结构重写：

```markdown
# DSH Git Graph
一句话定位 + 一张界面图（1200×700 左右，含图谱/胶囊/详情）

## 功能
- 图谱：分支级颜色、逐行宽度、合并/旁支走线、stash 与内部提交、未提交改动行
- 引用胶囊：本地/远程/标签，悬停提示，双击切换
- 提交详情：内嵌展开，作者/日期/父提交/完整说明 + 变更文件树/列表
- 差异：底部可拖拽抽屉，虚拟滚动，按文件分组
- 操作：切换/新建/删除/重命名分支，merge、rebase、reset、cherry-pick、revert、drop
- 标签与 stash：增删、推送、应用/弹出/删除
- 远端：fetch / push（含 force-with-lease）/ pull（指定远程分支）
- 查找与键盘：Ctrl+F 查找、Ctrl+R 刷新、Ctrl+H 跳 HEAD、方向键按分支导航
- 多仓库：自动发现会话目录下的仓库，下拉切换

## 快速开始
### 从市场安装（推荐）
设置 → 插件 → 发现 → 搜索 "Git Graph" → 安装 → 重启
### 从 npm 安装
dsh plugin --profile desktop add dsh-vsc-git-graph
### 从压缩包安装
设置 → 插件 → 压缩包 → 选 dsh-vsc-git-graph-<版本>.tgz

## 使用
- 打开：会话页签里点 "Git Graph"
- 点击提交展开详情；点文件看差异；右键看操作菜单
- 切换分支：右键分支胶囊 → 切换，或双击

## 要求
- DSH Desktop ≥ 0.1.0-rc.5（以 package.json 的 engines.dsh 为准）
- Git 在 PATH 中；Node ≥ 20（仅开发/构建需要）

## 开发
npm install / npm run build / npm test

## 许可与来源
（保留现有内容：自有 MIT + 第三方许可说明）
```

配图建议（需要你截 3 张）：图谱全貌、右键菜单、内嵌详情 + diff 抽屉。放 `docs/assets/`，
README 里用相对路径引用。

---

## 5. 发布检查清单

- [ ] `package.json`：删 `private`、补 `repository`/`homepage`/`bugs`/`engines.dsh`
- [ ] `npm test` 全绿（135 通过 / 2 跳过）
- [ ] `npm pack --dry-run` 内容符合预期（11 个文件）
- [ ] `npm publish --access public`
- [ ] 在 `desktop` profile 用 npm 包名安装并验证一次
- [ ] GitHub 仓库加 `dsh-plugin` topic
- [ ] 仓库满 1 天后提 awesome-dsh-plugin PR（`data/plugins/Si-xiyu__dsh-git-graph.yml`）
- [ ] 收录后检查市场卡片（描述、分类、图标、截图）
- [ ] 重写 README（第 4 节结构）
