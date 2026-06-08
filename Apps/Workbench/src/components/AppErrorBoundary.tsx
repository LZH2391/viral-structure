import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
  title?: string;
  resetKey?: string | number | null;
  maxAutoRetries?: number;
  autoRetryDelayMs?: number;
};

type AppErrorBoundaryState = {
  error: Error | null;
  autoRetryCount: number;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, autoRetryCount: 0 };
  private autoRetryTimer: number | null = null;

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // The fallback keeps the workbench usable without exposing stack traces in UI.
    this.queueAutoRetry();
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey) {
      this.clearAutoRetry();
      if (this.state.error || this.state.autoRetryCount !== 0) {
        this.setState({ error: null, autoRetryCount: 0 });
      }
    }
  }

  componentWillUnmount() {
    this.clearAutoRetry();
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || "界面渲染失败";
    const maxAutoRetries = this.props.maxAutoRetries ?? 1;
    const willAutoRetry = this.state.autoRetryCount < maxAutoRetries;
    if (willAutoRetry) return null;
    return (
      <section className="app-error-boundary" role="alert">
        <div className="app-error-boundary-card">
          <span>界面异常</span>
          <strong>{this.props.title ?? "当前界面暂时不可用"}</strong>
          <p>{message}</p>
          <div>
            <button type="button" onClick={() => this.retryNow()}>
              重试
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </div>
      </section>
    );
  }

  private queueAutoRetry() {
    const maxAutoRetries = this.props.maxAutoRetries ?? 1;
    if (this.state.autoRetryCount >= maxAutoRetries || this.autoRetryTimer !== null) return;
    const delay = this.props.autoRetryDelayMs ?? 400;
    this.autoRetryTimer = window.setTimeout(() => {
      this.autoRetryTimer = null;
      this.setState((current) => ({
        error: null,
        autoRetryCount: current.autoRetryCount + 1,
      }));
    }, delay);
  }

  private retryNow() {
    this.clearAutoRetry();
    this.setState({ error: null, autoRetryCount: 0 });
  }

  private clearAutoRetry() {
    if (this.autoRetryTimer === null) return;
    window.clearTimeout(this.autoRetryTimer);
    this.autoRetryTimer = null;
  }
}
