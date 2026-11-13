# 第三方许可与来源说明

本仓库包含多个来源的代码，各自的许可**不互相覆盖**。本文件说明「哪一段代码归谁、按什么条款」。

## 1. 本仓库自己的代码

- `LICENSE`（根目录）：MIT，版权人 `Si-xiyu`。
- 适用：`lib/index.js`、`src/graph.js`、`src/diff.js`、`src/styles.js`、`src/module.js`、
  `src/view.js`、`scripts/`、`test/`。

## 2. enoughpower/dsh-git-graph（MIT）

- 出处：<https://github.com/enoughpower/dsh-git-graph>
- 原文：`licenses/LICENSE_enoughpower-dsh-git-graph`
- 适用：本仓库基线的宿主接口与客户端骨架（初版 `lib/index.js`、初版客户端结构、部分测试）
  由其 MIT 代码继续开发而来；`vendor/legacy-client-bundle.js` 为其中期产物存档。
- 义务：保留其版权声明与许可原文（已随仓库提供）。

## 3. mhutchie/vscode-git-graph（**非**标准 MIT，限制发布衍生作品）

- 出处：<https://github.com/mhutchie/vscode-git-graph>
- 原文：`licenses/LICENSE_mhutchie-vscode-git-graph`（仅作参考留存；本仓库**不包含**其代码）

### 现状

`src/graph.js`（图谱布局引擎）是按 [`docs/GRAPH-SPEC.md`](docs/GRAPH-SPEC.md) 的行为规格
独立实现的：
- 行为与参考实现一致，这是**刻意**的，目的是让界面视觉与其一致；
- 源码文本不构成复制：与本仓库早期那版移植实现相比，完全相同的代码行仅 11 行（占 4.8%，
  全部是 `};`、`}`、`return -1;` 之类的语法行），最长连续相同片段 3 行，上游特有标识符
  （`determinePath`、`registerUnavailablePoint`、`class Graph/Vertex/Branch` 等 11 个）0 处；
- 那一版移植实现已从仓库历史中整体移除，当前历史只包含本实现。

### 边界说明

"行为/算法等价"在实务上仍可能被主张为非字面相似。因此：
- 本项目**不使用**上游名称暗示官方关系；README 中仅以 "参考 / inspired by" 方式致谢。
- 若上游作者对此有异议，本项目将按其要求进一步调整实现或移除相关行为。

## 4. 未引入的第三方资产

上游扩展还分发 Microsoft 与 Octicons 的图标许可（其 `LICENSE` 末尾所列）。本仓库**未复制**
其图标资源：界面图标为内联 SVG 或使用 DSH primitives，故不需要转授这两份许可。
如后续引入任何上游图标/资源，必须同时补入对应许可原文。
