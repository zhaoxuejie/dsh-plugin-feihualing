/**
 * 浮层游戏面板主体（portal 到 body 的独立 surface）。
 * M1：骨架 UI（标题/令字/对局信息/诗句流/输入条的结构与空态）；
 * 对局玩法引擎（内置对手、即时判定、计分）在 game/ 模块接入。
 * @module dsh-plugin-feihualing/client/panel
 */

import React from 'react'

export interface GamePanelProps {
  /** 所属会话 id（session 级 header 按钮注入）。 */
  sessionId: string
  /** 关闭面板。 */
  onClose: () => void
}

/** 会话短标识（展示用）。 */
function shortSession(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 10)}…` : sessionId
}

/**
 * 面板主体。当前为空态骨架：展示会话绑定与对战区域结构；
 * 内置对手引擎接入后此处渲染实时对局。
 */
export function GamePanel(props: GamePanelProps): React.ReactElement {
  const { sessionId, onClose } = props
  return (
    <div className="fhl-root fhl-panel" data-plugin="dsh-plugin-feihualing">
      <div className="fhl-panel-header">
        <span className="fhl-panel-title">🎴 飞花令 · 即时对战</span>
        <span className="fhl-tag" title={sessionId}>会话 {shortSession(sessionId)}</span>
        <button type="button" className="fhl-panel-close" onClick={onClose} title="关闭">✕</button>
      </div>
      <div className="fhl-muted" style={{ fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
        面板骨架已就绪 —— 内置对手引擎即将接入<br />
        <span style={{ opacity: 0.7, fontSize: 12 }}>（令字 · 倒计时 · 连击 · 局制）</span>
      </div>
    </div>
  )
}
