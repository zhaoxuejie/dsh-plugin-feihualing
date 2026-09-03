/**
 * 面板对战战绩（localStorage 持久化，本机会话无关、跨刷新保留）。
 * 纯浏览器模块；与 Host 对话模式状态互不干扰（面板是独立即时战）。
 * @module dsh-plugin-feihualing/client/game/stats
 */

import type { MatchState } from './engine.ts'

export interface GameStats {
  /** 累计胜局。 */
  wins: number
  /** 累计败局。 */
  losses: number
  /** 历史最佳得分。 */
  bestScore: number
  /** 当前连胜。 */
  streak: number
  /** 历史最长连胜。 */
  bestStreak: number
  /** 累计答对题数。 */
  solvedTotal: number
}

const KEY = 'dsh-plugin-feihualing:stats'

function empty(): GameStats {
  return { wins: 0, losses: 0, bestScore: 0, streak: 0, bestStreak: 0, solvedTotal: 0 }
}

/** 读取战绩（损坏/缺失返回空战绩）。 */
export function loadStats(): GameStats {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return empty()
    const parsed = JSON.parse(raw) as Partial<GameStats>
    return {
      wins: typeof parsed.wins === 'number' ? parsed.wins : 0,
      losses: typeof parsed.losses === 'number' ? parsed.losses : 0,
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : 0,
      streak: typeof parsed.streak === 'number' ? parsed.streak : 0,
      bestStreak: typeof parsed.bestStreak === 'number' ? parsed.bestStreak : 0,
      solvedTotal: typeof parsed.solvedTotal === 'number' ? parsed.solvedTotal : 0,
    }
  } catch {
    return empty()
  }
}

/** 结算一局并入账（返回并持久化新战绩）。 */
export function recordResult(stats: GameStats, match: MatchState): GameStats {
  const won = match.phase === 'won'
  const next: GameStats = {
    ...stats,
    wins: stats.wins + (won ? 1 : 0),
    losses: stats.losses + (won ? 0 : 1),
    bestScore: Math.max(stats.bestScore, match.score),
    streak: won ? stats.streak + 1 : 0,
    bestStreak: Math.max(stats.bestStreak, won ? stats.streak + 1 : stats.bestStreak),
    solvedTotal: stats.solvedTotal + match.solved,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 存储失败（隐私模式等）不影响对局 */
  }
  return next
}
