/**
 * 客户端半边样式：一次性注入 <style>，全部 fhl-* 类以 data-plugin 根类名限定作用域。
 * 主题跟随 DSH：深色模式由 body[data-ds-dark-theme] 标识（官方约定），
 * 浅色/深色各写一套语义配色；不依赖任何宿主私有类名。
 * @module dsh-plugin-feihualing/client/styles
 */

const CSS = `
[data-plugin="dsh-plugin-feihualing"].fhl-root, .fhl-root {
  --fhl-bg: #ffffff;
  --fhl-bg-elev: #f4f4f5;
  --fhl-fg: #27272a;
  --fhl-fg-muted: #71717a;
  --fhl-accent: #8b5cf6;
  --fhl-accent-soft: rgba(139, 92, 246, 0.12);
  --fhl-border: rgba(0, 0, 0, 0.1);
  --fhl-ok: #16a34a;
  --fhl-ok-soft: rgba(22, 163, 74, 0.12);
  --fhl-bad: #dc2626;
  --fhl-bad-soft: rgba(220, 38, 38, 0.12);
  font-family: var(--dsh-content-font, ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif);
  box-sizing: border-box;
}
body[data-ds-dark-theme] .fhl-root {
  --fhl-bg: #18181b;
  --fhl-bg-elev: #27272a;
  --fhl-fg: #e4e4e7;
  --fhl-fg-muted: #a1a1aa;
  --fhl-accent: #a78bfa;
  --fhl-accent-soft: rgba(167, 139, 250, 0.16);
  --fhl-border: rgba(255, 255, 255, 0.12);
  --fhl-ok: #4ade80;
  --fhl-ok-soft: rgba(74, 222, 128, 0.16);
  --fhl-bad: #f87171;
  --fhl-bad-soft: rgba(248, 113, 113, 0.16);
}
.fhl-root *, .fhl-root *::before, .fhl-root *::after { box-sizing: border-box; }

/* 会话头操作行的小按钮 */
.fhl-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--fhl-fg-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.fhl-toggle:hover { background: var(--fhl-accent-soft); color: var(--fhl-fg); }
.fhl-toggle[data-active="true"] { background: var(--fhl-accent-soft); color: var(--fhl-accent); }

/* 浮层游戏面板（portal 到 body 的独立 surface，自带作用域） */
.fhl-panel {
  position: fixed;
  top: 64px;
  right: 16px;
  width: 340px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 88px);
  overflow: auto;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: var(--fhl-bg);
  color: var(--fhl-fg);
  border: 1px solid var(--fhl-border);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.fhl-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.fhl-panel-title { font-weight: 700; font-size: 14px; letter-spacing: 0.02em; }
.fhl-panel-close {
  border: none;
  background: transparent;
  color: var(--fhl-fg-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 4px;
  border-radius: 6px;
}
.fhl-panel-close:hover { background: var(--fhl-bad-soft); color: var(--fhl-bad); }
.fhl-muted { color: var(--fhl-fg-muted); }
.fhl-tag { font-size: 11px; color: var(--fhl-fg-muted); border: 1px solid var(--fhl-border); padding: 1px 6px; border-radius: 999px; }
`

/** 注入样式表；返回 disposer（卸载时移除 style 节点）。 */
export function injectStyles(): () => void {
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-plugin-feihualing')
  style.textContent = CSS
  document.head.appendChild(style)
  return () => {
    if (style.parentNode) style.parentNode.removeChild(style)
  }
}
