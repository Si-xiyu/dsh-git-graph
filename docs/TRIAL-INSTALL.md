# 试用安装说明

分发物只有**一个文件**：`dsh-vsc-git-graph-0.1.0.tgz`（约 59 KB）。

## 前提

- 已经装好 **DSH Desktop**，版本不低于 `0.1.0-rc.5`。插件有宿主端和客户端两半，只能跑在 DSH 里，不能单独启动。
- `git` 在 `PATH` 上——插件直接调用系统 git，不自带。

## 安装（图形界面，推荐）

1. 打开 DSH Desktop → **设置 → 插件**。
2. 点安装，把安装来源选成 **压缩包**，填 tgz 的**绝对路径**：
   - macOS：`/Users/you/Downloads/dsh-vsc-git-graph-0.1.0.tgz`
   - Windows：`C:\Users\you\Downloads\dsh-vsc-git-graph-0.1.0.tgz`
3. 装完如果提示「立即启用」，选它。
4. 重启 DSH Desktop。

> 来源也可以选 **本地目录**：把 tgz 解开，填解压出来的 `package/` 目录的绝对路径，效果一样。

## 安装（命令行等价）

```sh
dsh plugin --profile desktop add /绝对路径/dsh-vsc-git-graph-0.1.0.tgz
```

`dsh` 的位置：

- macOS：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`
- Windows：`…\resources\runtime\cli\bin\dsh.cmd`

注意命令行这条只是把参数转发给 pnpm，装完仍需在 **设置 → 插件** 里启用，否则宿主端不会加载。

## 用起来

重启后在一个 Git 仓库目录里开个会话，顶部的 **Git Graph** 页签就是提交图：

- 单击提交 → 下方抽屉显示改动文件与 diff
- 右键分支标签 → 切换到；右键提交 → 从此提交新建分支
- 右上角齿轮 → 显示哪些列/排序/抓取时清理失效引用，以及中英文切换（默认跟随宿主语言）

## 卸载

**设置 → 插件 → 卸载**，或命令行：

```sh
dsh plugin --profile desktop remove dsh-vsc-git-graph
```

## 限制

- **仅限本机试用，不要再转发**：图谱布局引擎移植自
  发布/分发衍生作品。包内 `THIRD_PARTY_NOTICES.md` 有完整说明。
- 包是 `private: true` 的，不是 npm 包，不要尝试 `npm publish`。
- DSH 主程序如果升级到内部 client 接口有变化的大版本，插件可能需要跟着更新。
