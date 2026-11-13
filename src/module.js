export function apply(ctx) {
  // 语言由宿主的 locale 服务决定（settings.locale 偏好，未设置时退回浏览器语言），
  // 组件初次挂载读快照，用户手动选择后不再跟随。
  ctx.slots.inject("conversation.view", () => ctx.slots.register({ name:"conversation.view", id:"vsc-git-graph", order:21, label: () => "Git Graph", inject: () => ({}) }, (props) => jsx(GitGraphView, { ...props, locale: ctx.locale })));
}
exports.apply = apply;
exports.inject = ["slots", "locale"];
