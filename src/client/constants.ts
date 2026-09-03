/**
 * 客户端半边共享常量。
 * NAMESPACE 用作插槽注册 id，须与包名（package.json name / cordis.patch.yml）一致。
 * @module dsh-plugin-feihualing/client/constants
 */

/** 插件命名空间（与 cordis.patch.yml 的 id、Loader 行 name 保持一致）。 */
export const NAMESPACE = 'dsh-plugin-feihualing'

/** 面板在会话标题操作行中的渲染顺序（靠后，避免挤占内置预设/任务按钮）。 */
export const HEADER_ORDER = 90
