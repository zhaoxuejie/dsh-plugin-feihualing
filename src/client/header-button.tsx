/**
 * 会话标题操作按钮（conversation.session.header.actions 插槽，session 级 list）。
 * 点击后在 body 上挂载游戏浮层面板（portal，自带 surface 作用域，不触碰宿主 DOM）。
 * 面板的开合状态按组件实例维护；组件卸载（会话视图关闭）时同步收起面板。
 * @module dsh-plugin-feihualing/client/header-button
 */

import React from 'react'
import { createPortal } from 'react-dom'
import { HEADER_ORDER, NAMESPACE } from './constants.ts'
import type { LocalContext } from './types.ts'
import { GamePanel } from './panel.tsx'

/** 在会话头操作行注册游戏开关按钮。 */
export function registerHeaderButton(ctx: LocalContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: NAMESPACE,
      order: HEADER_ORDER,
      inject: (sessionId) => ({ sessionId }),
    },
    HeaderButton,
  ))
}

/** 会话头游戏开关按钮（点击开合浮层面板）。 */
function HeaderButton(props: { sessionId?: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [host] = React.useState<HTMLDivElement | null>(() => {
    const el = document.createElement('div')
    el.setAttribute('data-plugin', 'dsh-plugin-feihualing')
    el.setAttribute('data-fhl-portal', '')
    document.body.appendChild(el)
    return el
  })

  // 组件卸载（如会话视图关闭）时收起面板并移除 portal 宿主
  React.useEffect(() => {
    return () => {
      setOpen(false)
      if (host && host.parentNode) host.parentNode.removeChild(host)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sessionId = props.sessionId ?? ''
  const toggle = React.useCallback(() => setOpen((prev) => !prev), [])

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'fhl-toggle',
        'data-active': open ? 'true' : 'false',
        onClick: toggle,
        title: open ? '收起飞花令' : '飞花令小游戏',
        'aria-label': '飞花令小游戏',
      },
      '🎴',
    ),
    host !== null && open
      ? createPortal(
          React.createElement(GamePanel, { sessionId, onClose: () => setOpen(false) }),
          host,
        )
      : null,
  )
}
