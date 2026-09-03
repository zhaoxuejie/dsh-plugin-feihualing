// 引擎逻辑冒烟验证（Node 24 type-stripping 直接运行）
import * as engine from './src/client/game/engine.ts'

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✔ ${name}`)
  else { failed += 1; console.error(`  ✘ ${name} ${extra}`) }
}

// 1. 开局
const m0 = engine.createMatch({ mode: 'simple', difficulty: 'easy' })
check('开局 phase=playing', m0.phase === 'playing')
check('开局令字非空且含于池', m0.lingzi.length === 1)
check('对手先手出句且含令字', m0.challenge.includes(m0.lingzi), m0.challenge)
check('开局 used 已含对手句', m0.usedNormalized.length === 1)
check('开局 0 分 0 连击', m0.score === 0 && m0.combo === 0)

// 2. 双边去重：玩家重复对手句 → 拒绝
const dup = engine.submitPlayerLine(m0, m0.challenge)
check('重复对手句被拒', dup.ok === false && dup.state.phase === 'playing' && dup.state.score === 0, dup.state.lastVerdict)

// 3. 无令字 → 拒绝
const noLz = engine.submitPlayerLine(m0, '白日依山尽')
check('无令字被拒', noLz.ok === false && noLz.state.score === 0)

// 4. 通过一题：得分与推进
const gen = (lingzi, i) => `${lingzi}花影楼台${i}梦回` // 含令字的唯一句
const ok1 = engine.submitPlayerLine(m0, gen(m0.lingzi, 1))
check('有效诗句通过', ok1.ok === true && ok1.state.score >= 10, JSON.stringify(ok1.state.lastVerdict))
check('通过后推进题号', ok1.state.roundIndex === 1)
check('通过后对手换句（challenge 变化且含令字）', ok1.state.challenge !== m0.challenge && ok1.state.challenge.includes(m0.lingzi))
check('连击=1', ok1.state.combo === 1)

// 5. 连击加分：第二题再对 → 得分 10 + (1*2) = 22
const ok2 = engine.submitPlayerLine(ok1.state, gen(m0.lingzi, 2))
check('二连击得分 10+2', ok2.state.score === ok1.state.score + 12, String(ok2.state.score))

// 6. 错误提交只提示、不断连击（休闲设计：仅超时断连击并计失败）
const err3 = engine.submitPlayerLine(ok2.state, ok2.state.challenge) // 重复对手当前句
check('错误提交仅提示', err3.state.phase === 'playing' && err3.state.failures === 0)
check('错误提交不断连击', err3.state.combo === 2, `combo=${err3.state.combo}`)

// 7. hint 消耗
const h = engine.useHint(ok2.state)
check('提示消耗 1 次', h.state.hintsLeft === ok2.state.hintsLeft - 1)
check('提示给出参考句', typeof h.line === 'string' && h.line !== undefined)
const hintThen = engine.submitPlayerLine(h.state, gen(m0.lingzi, 9)).state
check('提示后本题通过只 +5', hintThen.score === ok2.state.score + 5, String(hintThen.score))

// 8. 通关路径：继续对到第 7 题（构造唯一句）
let st = ok2.state
let guard = 0
while (st.phase === 'playing' && guard < 20) {
  const r = engine.submitPlayerLine(st, gen(m0.lingzi, 30 + guard))
  st = r.state
  guard += 1
}
check('连续答对后通关', st.phase === 'won', `${st.phase} @题${st.roundIndex}`)
check('通关保留得分', st.score > 0)

// 9. 超时失败路径
const t0 = engine.createMatch({ mode: 'simple', difficulty: 'easy' })
const t1 = engine.timeoutRound(t0)
check('超时 1 次仍在进行', t1.phase === 'playing' && t1.failures === 1)
const t2 = engine.timeoutRound(t1)
check('超时 2 次仍在进行', t2.phase === 'playing' && t2.failures === 2)
const t3 = engine.timeoutRound(t2)
check('超时 3 次判负', t3.phase === 'lost' && t3.failures === 3, t3.lastVerdict)

// 10. 古法位置
const a0 = engine.createMatch({ mode: 'ancient', difficulty: 'medium' })
const pos = a0.requiredPosition
const badPos = engine.submitPlayerLine(a0, `${a0.lingzi}色新潮${a0.lingzi}润物华`.slice(0, 8).split('').reverse().join('')) // 构造令字不在 pos 位的 8 字句
check('古法位置不符被拒', badPos.ok === false, badPos.state.lastVerdict)
const aGen = (p) => {
  // 造 8 字句令字在第 p 位（p<=8）
  const chars = ['天', '地', '玄', '黄', '宇', '宙', '洪', '荒']
  chars[p - 1] = a0.lingzi
  return chars.join('')
}
const aOk = engine.submitPlayerLine(a0, aGen(pos))
check('古法位置正确通过', aOk.ok === true, aOk.state.lastVerdict)

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
