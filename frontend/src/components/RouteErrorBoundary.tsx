import { Component, type PropsWithChildren } from "react";

export class RouteErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">页面暂时没有加载出来</h1>
        <p className="mt-3 text-muted">可能刚刚发布了新版本，重新加载后继续。</p>
        <a className="ui-button mx-auto mt-6" href={`${window.location.pathname}${window.location.search}${window.location.hash}`}>
          重新加载页面
        </a>
        <a className="ui-link mx-auto mt-4" href="/">返回首页</a>
      </main>
    );
  }
}
