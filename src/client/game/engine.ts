/**
 * 内置 AI 对手 · 即时对战引擎（纯逻辑，零平台依赖、不依赖 React）。
 * 与 Host 共用 shared/rules.ts 的判定与 shared/poems.ts 的诗库：
 *   - 判定：judgePoemAttempt —— 面板即时判定与对话判定规则完全一致；
 *   - 双边去重：对手（bot）出句与玩家诗句都登记进 used 集合，杜绝重复；
 *   - 对手出句：从诗库按难度取未使用句；库句不足即判玩家获胜。
 * @module dsh-plugin-feihualing/client/game/engine
 */

import { judgePoemAttempt, MAX_ANCIENT_POSITION, normalizeLine } from '../../shared/rules.ts'
import type { GameMode } from '../../shared/rules.ts'
import { EASY_LINGZI, HARD_LINGZI, LINGZI_POOL, POEM_BANK } from '../../shared/poems.ts'

/** 对手难度。 */
export type Difficulty = 'easy' | 'medium' | 'hard'

/** 对局阶段。 */
export type MatchPhase = 'playing' | 'won' | 'lost'

/** 本局上限题数（每键诗库 ≥8 句，扣除双方占用后仍充足）。 */
export const MAX_ROUNDS = 7

/** 失败（超时）上限，达到即判负。 */
export const FAIL_LIMIT = 3

/** 每局提示次数。 */
export const HINTS_PER_MATCH = 3

/** 每题限时（秒），按难度递减。 */
export const TIME_LIMIT: Readonly<Record<Difficulty, number>> = {
  easy: 30,
  medium: 20,
  hard: 15,
}

/** 基础得分：ancient 更严格故更高。 */
const SCORE_BASE: Readonly<Record<GameMode, number>> = { simple: 10, ancient: 15 }

/** 连击加成（每段连续 +2）。 */
const COMBO_BONUS = 2

/** 使用提示后本题通过的基础分。 */
const HINT_SCORE = 5

/** 对局快照。 */
export interface MatchState {
  phase: MatchPhase
  mode: GameMode
  difficulty: Difficulty
  /** 当前令字。 */
  lingzi: string
  /** 当前题号（0 起；玩家每答对一题推进）。 */
  roundIndex: number
  /** 玩家已成功题数（roundIndex 与失败推进的解耦计数）。 */
  solved: number
  /** 失败次数（超时）。 */
  failures: number
  /** 累计得分。 */
  score: number
  /** 当前连击数（连续答对；0 表示断连）。 */
  combo: number
  /** 双方已用诗句（展示原文）。 */
  usedRaw: string[]
  /** 双方已用诗句（规范化，双边去重依据）。 */
  usedNormalized: string[]
  /** 对手当前出的题（玩家要接的句子）。 */
  challenge: string
  /** 本回合是否使用过提示（使用后本题通过只计 HINT_SCORE 且断连击）。 */
  hintUsedThisRound: boolean
  /** 剩余提示次数。 */
  hintsLeft: number
  /** 最近一次判定/事件文案（面板状态条展示）。 */
  lastVerdict: string
  /** 古法模式本轮要求位置（1 起）；simple 恒 1。 */
  requiredPosition: number
  startedAt: number
}

/** 单局设置。 */
export interface MatchOptions {
  mode: GameMode
  difficulty: Difficulty
}

/** 玩家提交的裁决结果。 */
export interface SubmitOutcome {
  state: MatchState
  /** 是否本题通过（得分推进）。 */
  ok: boolean
}

// ---------- 内部小工具 ----------

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

function clone(state: MatchState): MatchState {
  return {
    ...state,
    usedRaw: [...state.usedRaw],
    usedNormalized: [...state.usedNormalized],
  }
}

/** 按难度抽令字：hard 用偏门字池，其余用常见字池。 */
function pickLingzi(difficulty: Difficulty): string {
  const pool = difficulty === 'hard' ? HARD_LINGZI : EASY_LINGZI
  return pick(pool.length > 0 ? pool : LINGZI_POOL)
}

/** 诗库中该令字的全部句子。 */
function bankOf(lingzi: string): readonly string[] {
  return POEM_BANK[lingzi] ?? []
}

/**
 * 从诗库挑一句未使用的句子（对手出句/提示候选）。
 * @returns 命中返回展示文本，库句被双方用完返回 undefined。
 */
function pickUnused(state: MatchState): string | undefined {
  const candidates = bankOf(state.lingzi).filter(
    (line) => !state.usedNormalized.includes(normalizeLine(line)),
  )
  if (candidates.length === 0) return undefined
  return pick(candidates)
}

// ---------- 公开 API ----------

/** 创建一局（抽令字 + 对手先手出题）。 */
export function createMatch(options: MatchOptions): MatchState {
  const lingzi = pickLingzi(options.difficulty)
  const base: MatchState = {
    phase: 'playing',
    mode: options.mode,
    difficulty: options.difficulty,
    lingzi,
    roundIndex: 0,
    solved: 0,
    failures: 0,
    score: 0,
    combo: 0,
    usedRaw: [],
    usedNormalized: [],
    challenge: '',
    hintUsedThisRound: false,
    hintsLeft: HINTS_PER_MATCH,
    lastVerdict: '',
    requiredPosition: 1,
    startedAt: Date.now(),
  }
  const opener = pickUnused(base)
  if (opener === undefined) {
    // 库为空（理论上不会发生）：以空白开局仍可玩
    return { ...base, lastVerdict: `令字「${lingzi}」，请出句` }
  }
  return {
    ...base,
    challenge: opener,
    usedRaw: [opener],
    usedNormalized: [normalizeForUsed(opener)],
    lastVerdict: `令字「${lingzi}」· 对手出题，请对诗`,
  }
}

/** 仅规范化用于登记的辅助（与判定同源）。 */
function normalizeForUsed(raw: string): string {
  return normalizeLine(raw)
}

/** 生成"通过"时的结算文案与计分（advance = 是否推进题号）。 */
function applySolved(state: MatchState, display: string): MatchState {
  const comboBefore = state.combo
  const hintPenalty = state.hintUsedThisRound
  const gain = hintPenalty
    ? HINT_SCORE
    : SCORE_BASE[state.mode] + comboBefore * COMBO_BONUS
  const next = clone(state)
  next.solved += 1
  next.combo = hintPenalty ? 0 : comboBefore + 1
  next.score += gain
  next.usedRaw.push(display)
  next.usedNormalized.push(normalizeForUsed(display))
  if (next.mode === 'ancient') {
    next.requiredPosition = (next.requiredPosition % MAX_ANCIENT_POSITION) + 1
  }
  next.roundIndex += 1
  next.hintUsedThisRound = false
  const streak = next.combo
  next.lastVerdict = `答对！+${gain}${streak >= 2 ? `（连击 ×${streak}）` : ''} · ${next.score} 分`
  return next
}

/** 推进到下一题（对手换句）；无句可出或已到上限即玩家获胜。 */
function advance(state: MatchState, why: string): MatchState {
  if (state.roundIndex >= MAX_ROUNDS) {
    return { ...clone(state), phase: 'won', lastVerdict: `通关！连对 ${state.solved} 题，共 ${state.score} 分（${why}）` }
  }
  const nextLine = pickUnused(state)
  if (nextLine === undefined) {
    const won = clone(state)
    won.phase = 'won'
    won.lastVerdict = `对手诗穷，你赢了！共 ${state.score} 分（${why}）`
    return won
  }
  const next = clone(state)
  next.challenge = nextLine
  next.usedRaw.push(nextLine)
  next.usedNormalized.push(normalizeForUsed(nextLine))
  next.lastVerdict = `${state.lastVerdict} —— 对手换题`
  return next
}

/** 玩家提交诗句。 */
export function submitPlayerLine(state: MatchState, rawText: string): SubmitOutcome {
  if (state.phase !== 'playing') return { state, ok: false }
  const result = judgePoemAttempt({
    rawText,
    lingzi: state.lingzi,
    mode: state.mode,
    requiredPosition: state.requiredPosition,
    usedNormalized: state.usedNormalized,
  })
  if (result.kind === 'notPoem') {
    return { state: { ...state, lastVerdict: `这句没有令字「${state.lingzi}」，请重新对诗` }, ok: false }
  }
  if (result.kind === 'length') {
    return { state: { ...state, lastVerdict: '诗句长度需在 4-48 字之间' }, ok: false }
  }
  if (result.kind === 'duplicate') {
    return { state: { ...state, lastVerdict: '这句用过了（双方都不能重复），换一句吧' }, ok: false }
  }
  if (result.kind === 'badPosition') {
    const pos = result.requiredPosition ?? state.requiredPosition
    const why = result.badPosReason === 'tooShort'
      ? `句子太短：古法要求令字位于第 ${pos} 字`
      : `位置不对：古法要求第 ${pos} 字是令字「${state.lingzi}」`
    return { state: { ...state, lastVerdict: why }, ok: false }
  }
  // 通过
  const solved = applySolved(state, result.display)
  const advanced = advance(solved, '答对推进')
  // 若本轮因对答通关/对手诗穷而 won，保留
  return { state: advanced, ok: true }
}

/** 超时（由面板倒计时触发）：本题作废，换题；连续失败达上限判负。 */
export function timeoutRound(state: MatchState): MatchState {
  if (state.phase !== 'playing') return state
  const next = clone(state)
  next.failures += 1
  next.combo = 0
  next.hintUsedThisRound = false
  if (next.failures >= FAIL_LIMIT) {
    next.phase = 'lost'
    next.lastVerdict = `超时 ${FAIL_LIMIT} 次，本局惜败 · 共答对 ${next.solved} 题 / ${next.score} 分`
    return next
  }
  next.lastVerdict = `超时（第 ${next.failures}/${FAIL_LIMIT} 次）—— 换下一题，加油`
  return advance(next, '超时换题')
}

/** 认输/放弃。 */
export function concedeMatch(state: MatchState): MatchState {
  if (state.phase !== 'playing') return state
  const next = clone(state)
  next.phase = 'lost'
  next.lastVerdict = `你认输了 · 共答对 ${next.solved} 题 / ${next.score} 分`
  return next
}

/** 提示：消耗 1 次，给出库中一句未用参考诗（可直接跟对，但只计 HINT_SCORE 且断连击）。 */
export function useHint(state: MatchState): { state: MatchState; line?: string } {
  if (state.phase !== 'playing' || state.hintsLeft <= 0) return { state }
  const next = clone(state)
  next.hintsLeft -= 1
  next.hintUsedThisRound = true
  const line = pickUnused(next)
  next.lastVerdict = line
    ? `提示（剩 ${next.hintsLeft} 次）：参考「${line}」—— 参考句直接对出只 +${HINT_SCORE} 分`
    : `提示（剩 ${next.hintsLeft} 次）：想一句含「${state.lingzi}」的诗句吧`
  return { state: next, line }
}

/** 换令字重开本局（保留设置）。 */
export function restartMatch(options: MatchOptions): MatchState {
  return createMatch(options)
}
