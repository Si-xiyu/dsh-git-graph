export function apply(ctx) {
  // 语言由宿主的 locale 服务决定（settings.locale 偏好，未设置时退回浏览器语言），
  // 组件初次挂载读快照，用户手动选择后不再跟随。
  ctx.slots.inject("conversation.view", () => ctx.slots.register({ name:"conversation.view", id:"vsc-git-graph", order:21, label: () => "Git Graph", inject: () => ({}) }, (props) => jsx(GitGraphErrorBoundary, { ...props, locale: ctx.locale }, props.sessionId)));
}
exports.apply = apply;
exports.inject = ["slots", "locale"];

// 将渲染 / 生命周期异常隔离在插件页签内，避免宿主整页卸载。
class GitGraphErrorBoundary extends react.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, attempt: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Git Graph] View crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return jsx(GitGraphView, { ...this.props }, this.state.attempt);
    const lang = readSavedLang() || detectLang(this.props.locale);
    const L = (zh, en) => lang === 'zh' ? zh : en;
    return jsxs('div', {
      className: 'dshGraph', 'data-git-view': true,
      style: { padding: 16, gap: 12 },
      children: [
        jsx('strong', { role: 'alert', children: L('Git Graph 显示异常', 'Git Graph could not render') }),
        jsx('p', { children: L('可以重新加载此视图恢复。', 'Reload this view to recover.') }),
        jsx('pre', { style: { whiteSpace: 'pre-wrap', overflow: 'auto' }, children: String(this.state.error?.message || this.state.error) }),
        jsx('button', {
          onClick: () => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 })),
          children: L('重新加载视图', 'Reload view'),
        }),
      ],
    });
  }
}
