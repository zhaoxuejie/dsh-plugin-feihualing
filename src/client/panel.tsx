/**
 * 浮层游戏面板（完整对战 UI）。
 * 对局状态由 HeaderButton 层持有（useGamePanel），本组件只做展示与事件转发：
 * 关闭面板只隐藏，不丢对局；隐藏期间倒计时暂停（视同暂停）。
 * @module dsh-plugin-feihualing/client/panel
 */

import React from 'react'
import * as engine from './game/engine.ts'
import type { GamePanelApi } from './game/useGame.ts'

export interface GamePanelProps {
  /** 所属会话 id（session 级 header 按钮注入）。 */
  sessionId: string
  /** 关闭面板（仅隐藏，对局保留）。 */
  onClose: () => void
  /** 对局控制面（由父层 useGamePanel 提供）。 */
  api: GamePanelApi
}

/** 会话短标识（展示用）。 */
function shortSession(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 10)}…` : sessionId
}

const MODE_LABEL: Record<string, string> = { simple: '简易', ancient: '古法' }
const DIFF_LABEL: Record<string, string> = { easy: '轻松', medium: '标准', hard: '困难' }
const DIFF_HINT: Record<string, string> = { easy: '常见令字 · 30s', medium: '常见令字 · 20s', hard: '冷门令字 · 15s' }

/** 开局设置行（未开局或对局结束后显示）。 */
function SetupView(props: { api: GamePanelApi }): React.ReactElement {
  const { api } = props
  return (
    <React.Fragment>
      <div className="fhl-row">
        <span className="fhl-seg-label">模式</span>
        <div className="fhl-seg">
          {(['simple', 'ancient'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`fhl-seg-item${api.mode === m ? ' is-active' : ''}`}
              onClick={() => api.setMode(m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="fhl-row">
        <span className="fhl-seg-label">难度</span>
        <div className="fhl-seg">
          {(['easy', 'medium', 'hard'] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`fhl-seg-item${api.difficulty === d ? ' is-active' : ''}`}
              onClick={() => api.setDifficulty(d)}
              title={DIFF_HINT[d]}
            >
              {DIFF_LABEL[d]}
            </button>
          ))}
        </div>
      </div>
      <div className="fhl-muted" style={{ fontSize: 12, textAlign: 'center', paddingBottom: 4 }}>
        {api.mode === 'ancient'
          ? '古法：令字须按位置循环（第 1 字 → 第 7 字）'
          : '简易：诗句任意位置含令字即可'}
        {' · '}
        {DIFF_HINT[api.difficulty]}
      </div>
      <button type="button" className="fhl-btn fhl-btn-primary" onClick={api.start}>
        🎴 开始对局
      </button>
      <div className="fhl-muted" style={{ fontSize: 11, textAlign: 'center' }}>
        对手出题 · 你限时对诗 · 连对 {engine.MAX_ROUNDS} 题通关 · 超时 {engine.FAIL_LIMIT} 次惜败
      </div>
    </React.Fragment>
  )
}

/** 进行中对局视图。 */
function PlayView(props: { api: GamePanelApi }): React.ReactElement {
  const { api } = props
  const match = api.match
  if (match === null) return <React.Fragment />
  const timeLow = api.secondsLeft <= 5
  const canAct = match.phase === 'playing'
  return (
    <React.Fragment>
      <div className="fhl-stage">
        <span className="fhl-stage-round">第 {match.roundIndex + 1}/{engine.MAX_ROUNDS} 题</span>
        <span className={`fhl-timer${timeLow && canAct ? ' is-low' : ''}`}>{api.secondsLeft}s</span>
        <span className="fhl-stage-tag">{MODE_LABEL[match.mode]} · {DIFF_LABEL[match.difficulty]}</span>
      </div>
      <div className="fhl-lingzi">「{match.lingzi}」</div>
      {match.mode === 'ancient' && (
        <div className="fhl-muted" style={{ fontSize: 11, textAlign: 'center', marginTop: -4 }}>
          古法：本轮令字须位于第 <b style={{ color: 'var(--fhl-accent)' }}>{match.requiredPosition}</b> 字
        </div>
      )}
      <div className="fhl-card fhl-card-bot">
        <span className="fhl-card-role">🤖 对手</span>
        <span className="fhl-card-line">{match.challenge}</span>
      </div>
      {match.lastVerdict !== '' && (
        <div className={`fhl-verdict${api.secondsLeft === 0 || !canAct ? '' : ''}`}>{match.lastVerdict}</div>
      )}
      <form
        className="fhl-input-row"
        onSubmit={(ev) => {
          ev.preventDefault()
          api.submit()
        }}
      >
        <input
          className="fhl-input"
          value={api.draft}
          onChange={(ev) => api.setDraft(ev.target.value)}
          placeholder={`说一句含「${match.lingzi}」的诗句…`}
          disabled={!canAct}
          autoComplete="off"
        />
        <button type="submit" className="fhl-btn fhl-btn-primary" disabled={!canAct}>对诗</button>
      </form>
      <div className="fhl-actions">
        <button
          type="button"
          className="fhl-btn"
          onClick={api.requestHint}
          disabled={!canAct || match.hintsLeft <= 0}
          title="消耗提示次数，给出参考诗句（参考句直接跟对只得 5 分）"
        >
          💡 提示（{match.hintsLeft}）
        </button>
        <button type="button" className="fhl-btn fhl-btn-danger" onClick={api.concede} disabled={!canAct}>
          认输
        </button>
      </div>
      <div className="fhl-stats">
        <span className="fhl-stat"><b>{match.score}</b> 得分</span>
        <span className="fhl-stat"><b>{match.combo}</b> 连击</span>
        <span className="fhl-stat"><b>{match.solved}/{engine.MAX_ROUNDS}</b> 答对</span>
        <span className={`fhl-stat${match.failures >= engine.FAIL_LIMIT - 1 ? ' is-warn' : ''}`}>
          <b>{match.failures}/{engine.FAIL_LIMIT}</b> 超时
        </span>
      </div>
    </React.Fragment>
  )
}

/** 结算视图。 */
function EndView(props: { api: GamePanelApi }): React.ReactElement {
  const { api } = props
  const match = api.match
  if (match === null) return <React.Fragment />
  const won = match.phase === 'won'
  return (
    <React.Fragment>
      <div className={`fhl-result${won ? ' is-won' : ' is-lost'}`}>
        <div className="fhl-result-icon">{won ? '🏆' : '😢'}</div>
        <div className="fhl-result-title">{won ? '通关！' : '本局惜败'}</div>
        <div className="fhl-muted" style={{ fontSize: 12, textAlign: 'center' }}>{match.lastVerdict}</div>
      </div>
      <div className="fhl-stats">
        <span className="fhl-stat"><b>{match.score}</b> 得分</span>
        <span className="fhl-stat"><b>{match.solved}</b> 答对</span>
        <span className="fhl-stat"><b>{match.failures}</b> 超时</span>
      </div>
      <div className="fhl-record">
        <span>🏅 {api.stats.wins} 胜 / {api.stats.losses} 负</span>
        <span>🔥 连胜 {api.stats.streak}</span>
        <span>✨ 最佳 {api.stats.bestScore}</span>
      </div>
      <button type="button" className="fhl-btn fhl-btn-primary" onClick={api.start}>
        🔄 再来一局
      </button>
      <div className="fhl-muted" style={{ fontSize: 11, textAlign: 'center' }}>
        令字「{match.lingzi}」· {MODE_LABEL[match.mode]} · {DIFF_LABEL[match.difficulty]}
      </div>
    </React.Fragment>
  )
}

/** 面板主体：按对局阶段切换视图。 */
export function GamePanel(props: GamePanelProps): React.ReactElement {
  const { sessionId, onClose, api } = props
  const phase = api.match === null ? 'setup' : api.match.phase
  return (
    <div className="fhl-root fhl-panel" data-plugin="dsh-plugin-feihualing">
      <div className="fhl-panel-header">
        <span className="fhl-panel-title">🎴 飞花令 · 即时对战</span>
        <span className="fhl-tag" title={sessionId}>会话 {shortSession(sessionId)}</span>
        <button type="button" className="fhl-panel-close" onClick={onClose} title="收起（对局保留）">✕</button>
      </div>
      {phase === 'setup' && <SetupView api={api} />}
      {phase === 'playing' && <PlayView api={api} />}
      {(phase === 'won' || phase === 'lost') && <EndView api={api} />}
    </div>
  )
}
