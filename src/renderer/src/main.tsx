import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('比价卡渲染失败', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
          <h1>比价卡启动失败</h1>
          <p>页面运行时发生错误，请把下面的信息发给开发者：</p>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#b14f45' }}>{this.state.error.message}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '10px 18px', border: 0, borderRadius: 8, color: 'white', background: '#226c51', cursor: 'pointer' }}
          >
            返回应用
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const root = createRoot(document.getElementById('root')!)

if (!window.compareApi) {
  root.render(
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>比价卡启动失败</h1>
      <p>安全接口没有加载（compareApi unavailable）。请重新生成免安装版本。</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ marginTop: 16, padding: '10px 18px', border: 0, borderRadius: 8, color: 'white', background: '#226c51', cursor: 'pointer' }}
      >
        重新加载
      </button>
    </div>
  )
} else {
  root.render(
    <StrictMode>
      <StartupErrorBoundary><App /></StartupErrorBoundary>
    </StrictMode>
  )
}
