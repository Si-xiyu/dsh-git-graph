# DSH Git Graph

在 DeepSeek Harness 的会话中打开 **Git Graph** 页签，查看当前工作目录的提交历史。图谱用彩色分支线和圆环标出分叉、合并和当前提交。

- 单击提交查看文件和差异。
- 右键本地分支标签并选择「切换到」，也可以双击标签。切换后刷新图谱和分支标记。
- 右键提交并选择「从此提交新建分支…」，输入名字后创建分支。
- 如果未提交的改动会被覆盖，Git 会拒绝切换，面板会显示 Git 返回的原因。

## 安装到 DSH Desktop

需要已安装 DSH Desktop（`>= 0.1.0-rc.5`）以及 `git`。插件同时有宿主端和客户端两半，不能脱离 DSH 单独运行。

**从分发包安装**：打开 **设置 → 插件**，安装来源选「压缩包」，填 `dsh-vsc-git-graph-<版本>.tgz` 的绝对路径；装完启用并重启 DSH Desktop。
详细的图文步骤见 [`docs/TRIAL-INSTALL.md`](docs/TRIAL-INSTALL.md)。

**从源码目录安装**（开发时）：

```sh
dsh plugin --profile desktop add /绝对路径/dsh-git-graph
```

重新打开 DSH Desktop 后，在一个 Git 工作目录的会话中打开 **Git Graph**。

## 开发

运行 `npm test`。测试需要 Git 和 Node.js 20 或以上版本。

改完 `src/` 后运行 `npm run build` 生成 `lib/client.js`（客户端产物入库，别手改）。
`npm run dist` 会先构建再把分发包打进 `dist/dsh-vsc-git-graph-<版本>.tgz`。


## 许可与来源

本项目自己的代码以 MIT 发布（见 [LICENSE](LICENSE)，版权人 `Si-xiyu`）。

- 基线来自 [enoughpower/dsh-git-graph](https://github.com/enoughpower/dsh-git-graph)（MIT），
  许可原文存于 [`licenses/`](licenses/)。
- 图谱与交互行为参照 [VS Code Git Graph](https://github.com/mhutchie/vscode-git-graph)：
  `src/graph.js` 是按 [`docs/GRAPH-SPEC.md`](docs/GRAPH-SPEC.md) 的行为规格独立实现的，
  行为刻意与参考实现保持一致（保证视觉一致），但源码文本不构成复制
  （与本仓库早期的移植版相比：完全相同的代码行 11 行、均为语法行；上游特有标识符 0 处）。
- 旧移植版本已从仓库历史中整体移除，当前历史只包含独立实现。
- 逐路径的归属与许可原文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
