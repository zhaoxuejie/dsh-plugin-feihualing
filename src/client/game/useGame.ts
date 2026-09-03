/**
 * React 对局 hook：包装 engine 的纯逻辑，管理倒计时与面板动作。
 * 倒计时由 useGamePanel 内部控制（setInterval，无第三方库）。
 * @module dsh-plugin-feihualing/client/game/useGame
 */

import React from 'react'
import * as engine from './engine.ts'
import type { GameStats } from './stats.ts'
import { loadStats, recordResult } from './stats.ts'
import type { GameMode } from '../../shared/rules.ts'

/** 对局控制面（供面板组件使用）。 */
export interface GamePanelApi {
  match: engine.MatchState | null
  secondsLeft: number
  mode: GameMode
  difficulty: engine.Difficulty
  draft: string
  stats: GameStats
  setMode(mode: GameMode): void
  setDifficulty(difficulty: engine.Difficulty): void
  setDraft(text: string): void
  start(): void
  submit(): void
  requestHint(): void
  concede(): void
}

/**
 * 一局对战面板状态。倒计时只在对局进行中且面板激活时跑；
 * 面板隐藏（active=false）视同暂停：计时停住、不超时，重开面板继续。
 * 答题推进/超时换题时按 (phase, roundIndex, challenge) 变化重置计时。
 * @param active 面板是否可见（决定倒计时是否运行）。
 */
export function useGamePanel(active: boolean): GamePanelApi {
  const [match, setMatch] = React.useState<engine.MatchState | null>(null)
  const [secondsLeft, setSecondsLeft] = React.useState(0)
  const [mode, setMode] = React.useState<GameMode>('simple')
  const [difficulty, setDifficulty] = React.useState<engine.Difficulty>('medium')
  const [draft, setDraft] = React.useState('')
  const [stats, setStats] = React.useState<GameStats>(() => loadStats())
  // 记录已入账的局（按 startedAt），防止同一局重复累计战绩
  const recordedStartedAt = React.useRef<number | null>(null)

  // 结算（won/lost）时入账一次战绩
  React.useEffect(() => {
    if (match === null || (match.phase !== 'won' && match.phase !== 'lost')) return
    if (recordedStartedAt.current === match.startedAt) return
    recordedStartedAt.current = match.startedAt
    setStats((cur) => recordResult(cur, match))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match])

  const roundKey = match === null
    ? ''
    : `${match.phase}:${match.roundIndex}:${match.challenge}`

  // 每一“题”（phase/题号/对手句变化）重置倒计时为满额限时
  React.useEffect(() => {
    if (match === null || match.phase !== 'playing') return
    setSecondsLeft(engine.TIME_LIMIT[match.difficulty])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundKey])

  // 秒针：仅面板激活且对局进行中时递减；隐藏（active=false）即暂停并保留剩余时间
  React.useEffect(() => {
    if (!active || match === null || match.phase !== 'playing') return
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roundKey])

  // 倒计时归零：本题超时
  React.useEffect(() => {
    if (!active || match === null || match.phase !== 'playing') return
    if (secondsLeft > 0) return
    setMatch((cur) => (cur !== null && cur.phase === 'playing' ? engine.timeoutRound(cur) : cur))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, active])

  const start = React.useCallback(() => {
    setMatch(engine.createMatch({ mode, difficulty }))
    setDraft('')
  }, [mode, difficulty])

  const submit = React.useCallback(() => {
    const text = draft.trim()
    if (text.length === 0) return
    setMatch((cur) => {
      if (cur === null || cur.phase !== 'playing') return cur
      const outcome = engine.submitPlayerLine(cur, text)
      return outcome.state
    })
    setDraft('')
  }, [draft])

  const requestHint = React.useCallback(() => {
    setMatch((cur) => {
      if (cur === null || cur.phase !== 'playing') return cur
      return engine.useHint(cur).state
    })
  }, [])

  const concede = React.useCallback(() => {
    setMatch((cur) => (cur === null ? cur : engine.concedeMatch(cur)))
  }, [])

  return {
    match,
    secondsLeft,
    mode,
    difficulty,
    draft,
    stats,
    setMode,
    setDifficulty,
    setDraft,
    start,
    submit,
    requestHint,
    concede,
  }
}
