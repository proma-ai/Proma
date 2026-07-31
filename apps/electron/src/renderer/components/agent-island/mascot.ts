/**
 * Mascot —— 灵动岛宠物动画
 *
 * 设计参考 Cindy (makecindy/cindy) 的 SpriteMascotView：
 * - 角色 = 矢量手绘身体 + 程序化眼睛；动画时间线共享，状态切换重置时间线
 * - 四状态动画与会话 phase 一一对应：
 *   idle 漂浮呼吸/眨眼/睡觉冒 Zzz；working 弹跳+敲键盘+点头；
 *   waiting 感叹号+蹦跳+摇头+外圈 glow；completed 跳跃+对勾徽章
 * - 16×16 单位坐标，按 size 缩放；keyframe lerp 做关键帧插值
 *
 * MVP 用纯 Canvas 矢量绘制（不依赖外部素材），后续可扩展为
 * PNG body + 眼睛几何参数（SpriteMascotConfig 等价物）。
 */

export type MascotState = 'idle' | 'working' | 'waiting' | 'completed'

export interface MascotConfig {
  /** 身体主色 */
  bodyColor: string
  /** 肚皮/腮红辅助色 */
  accentColor: string
  /** 眼睛颜色 */
  eyeColor: string
  /** 等待审批感叹号/glow 颜色 */
  alertColor: string
  /** 完成徽章颜色 */
  completionColor: string
  /** 键盘颜色 */
  keyboardColor: string
}

export const DEFAULT_MASCOT_CONFIG: MascotConfig = {
  bodyColor: '#3D7EFF',
  accentColor: '#FFD166',
  eyeColor: '#1D2B53',
  alertColor: '#FF3B30',
  completionColor: '#22C55E',
  keyboardColor: '#8A94A6',
}

export const MASCOT_STATE_COLORS: Record<MascotState, string> = {
  idle: '#3D7EFF',
  working: '#FF6600',
  waiting: '#00D9C5',
  completed: '#22C55E',
}

// ===== keyframe lerp =====

function lerp(keyframes: Array<[number, number]>, pct: number): number {
  const first = keyframes[0]
  if (!first) return 0
  if (pct <= first[0]) return first[1]
  for (let i = 1; i < keyframes.length; i++) {
    if (pct <= keyframes[i]![0]) {
      const span = keyframes[i]![0] - keyframes[i - 1]![0]
      if (span <= 0) return keyframes[i]![1]
      const t = (pct - keyframes[i - 1]![0]) / span
      return keyframes[i - 1]![1] + (keyframes[i]![1] - keyframes[i - 1]![1]) * t
    }
  }
  return keyframes[keyframes.length - 1]?.[1] ?? 0
}

// ===== 坐标工具 =====

class V {
  ox: number
  oy: number
  s: number
  constructor(size: number, grid = 16) {
    this.s = size / grid
    this.ox = (size - grid * this.s) / 2
    this.oy = (size - grid * this.s) / 2
  }
  x(x: number): number { return this.ox + x * this.s }
  y(y: number): number { return this.oy + y * this.s }
}

// ===== 绘制 =====

function drawEyes(
  ctx: CanvasRenderingContext2D,
  v: V,
  eyeColor: string,
  eyeScale: number,
  leftX: number,
  rightX: number,
  eyeY: number,
): void {
  const openness = eyeScale < 0.25 ? 0 : Math.min(eyeScale, 1.18)
  const closed = 1 - Math.min(openness, 1)
  const rx = (0.55 + 0.5 * closed) * v.s
  const ry = Math.max(0.28, (0.92 * openness + 0.08 * closed)) * v.s
  ctx.fillStyle = eyeColor
  for (const cx of [leftX, rightX]) {
    ctx.beginPath()
    ctx.ellipse(v.x(cx), v.y(eyeY), rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 在 y 方向上把 body 中心往下压一点（弹跳 squash） */
function drawBody(
  ctx: CanvasRenderingContext2D,
  v: V,
  cfg: MascotConfig,
  dy: number,
  squashX: number,
  squashY: number,
): void {
  const bodyCy = 9 + (1 - squashY) * 1.8
  const rx = 5.6 * squashX * v.s
  const ry = 5.6 * squashY * v.s
  ctx.fillStyle = cfg.bodyColor
  ctx.beginPath()
  ctx.ellipse(v.x(8), v.y(bodyCy) + dy * v.s, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()

  // 肚皮
  ctx.fillStyle = cfg.accentColor
  ctx.beginPath()
  ctx.ellipse(v.x(8), v.y(bodyCy + 1.6) + dy * v.s, rx * 0.5, ry * 0.45, 0, 0, Math.PI * 2)
  ctx.fill()

  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(v.x(8), v.y(14.6), rx * 0.8, 0.35 * v.s, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  v: V,
  cfg: MascotConfig,
  phase: number,
  dy: number,
): void {
  ctx.fillStyle = cfg.keyboardColor
  ctx.fillRect(v.x(1), v.y(13.2) + dy * v.s, 14 * v.s, 2.4 * v.s)
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      ctx.fillRect(v.x(1.4 + col * 2.35), v.y(13.6 + row * 1.1) + dy * v.s, 1.7 * v.s, 0.62 * v.s)
    }
  }
  // 高亮按下的键
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  const hi = phase % 6
  const hiRow = Math.floor(phase / 6) % 2
  ctx.fillRect(v.x(1.4 + hi * 2.35), v.y(13.6 + hiRow * 1.1) + dy * v.s, 1.7 * v.s, 0.62 * v.s)
}

function drawBang(
  ctx: CanvasRenderingContext2D,
  v: V,
  cfg: MascotConfig,
  pct: number,
): void {
  const opacity = lerp([[0, 0], [0.03, 1], [0.55, 1], [0.62, 0], [1, 0]], pct)
  if (opacity <= 0.01) return
  const scale = lerp([[0, 0.3], [0.03, 1.3], [0.1, 1.0], [0.55, 1.0], [0.62, 0.6], [1, 0.6]], pct)
  ctx.globalAlpha = opacity
  ctx.fillStyle = cfg.alertColor
  const bw = 1.6 * scale * v.s
  const bx = v.x(12.2)
  const by = v.y(1.6)
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, 3.2 * scale * v.s, bw * 0.45)
  ctx.fill()
  ctx.beginPath()
  ctx.roundRect(bx, by + 3.8 * scale * v.s, bw, 1.3 * scale * v.s, bw * 0.45)
  ctx.fill()
  ctx.globalAlpha = 1
}

function drawCompletionBadge(
  ctx: CanvasRenderingContext2D,
  v: V,
  cfg: MascotConfig,
  pct: number,
): void {
  const fade = pct < 0.92 ? 1 : Math.max(0, (1 - pct) / 0.08)
  const badgeScale = lerp([[0, 0.15], [0.1, 1.2], [0.2, 0.94], [0.32, 1.0], [0.92, 1.0], [1, 0.9]], pct)
  const cx = v.x(8)
  const cy = v.y(8)
  const r = 5.6 * badgeScale * v.s
  ctx.globalAlpha = fade
  ctx.fillStyle = cfg.completionColor
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  // 对勾
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 1.1 * badgeScale * v.s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - 2.1 * badgeScale * v.s, cy + 0.2 * badgeScale * v.s)
  ctx.lineTo(cx - 0.6 * badgeScale * v.s, cy + 1.6 * badgeScale * v.s)
  ctx.lineTo(cx + 2.5 * badgeScale * v.s, cy - 1.7 * badgeScale * v.s)
  ctx.stroke()
  ctx.globalAlpha = 1
}

// ===== 状态场景 =====

const IDLE_CYCLE = 4.9
const IDLE_SLEEP_START = 1.15

function drawIdle(ctx: CanvasRenderingContext2D, v: V, cfg: MascotConfig, t: number): void {
  const idleTime = t % IDLE_CYCLE
  const phase = idleTime / IDLE_CYCLE
  const float = Math.sin(phase * Math.PI * 2) * 0.42
  const breathe = Math.sin(phase * Math.PI * 2 + 0.6)
  const eyeScale = lerp(
    [
      [0, 1.08],
      [IDLE_SLEEP_START - 0.18, 1.08],
      [IDLE_SLEEP_START, 0],
      [IDLE_CYCLE - 0.28, 0],
      [IDLE_CYCLE, 1.08],
    ],
    idleTime,
  )
  drawBody(ctx, v, cfg, float, 1 + breathe * 0.012, 1 - breathe * 0.01)
  drawEyes(ctx, v, cfg.eyeColor, eyeScale, 6.7, 9.3, 9.4)

  // 睡觉冒 Zzz
  const sleepElapsed = idleTime - IDLE_SLEEP_START
  if (sleepElapsed > 0) {
    for (let i = 0; i < 3; i++) {
      const cycle = 2.8 + i * 0.3
      const delay = i * 0.9
      const localT = sleepElapsed - delay
      if (localT < 0) continue
      const p = (localT % cycle) / cycle
      const fontSize = Math.max(5, v.s * (2.6 + p * 1.6))
      const opacity = p < 0.8 ? 0.7 - i * 0.1 : (1 - p) * 3 * (0.7 - i * 0.1)
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, opacity)})`
      ctx.font = `900 ${fontSize}px ui-monospace, monospace`
      ctx.fillText('z', v.x(11.2 + i * 0.8) + Math.sin(p * Math.PI * 2) * v.s * 0.5, v.y(7 - p * 3.2))
    }
  }
}

const WORK_BOUNCE = 0.38

function drawWorking(ctx: CanvasRenderingContext2D, v: V, cfg: MascotConfig, t: number): void {
  const bounce = Math.sin((t * Math.PI * 2) / WORK_BOUNCE) * 0.72
  const breathe = Math.sin((t * Math.PI * 2) / 2.5)
  const keyPhase = Math.floor(t / 0.1) % 6
  const blink = t % 3.1
  const eyeScale = blink > 1.12 && blink < 1.23 ? 0 : 1
  const headTurn = Math.sin((t * Math.PI * 2) / 0.84) * 0.22
  const xShift = Math.sin((t * Math.PI * 2) / 0.72) * 0.18
  const dy = bounce - 0.25

  drawKeyboard(ctx, v, cfg, keyPhase, 0)
  drawBody(ctx, v, cfg, dy, 1 + breathe * 0.008, dy > 0.25 ? 0.98 : 1)
  // 头部轻微转动：整体旋转太复杂，这里用眼睛位置左右移动模拟
  drawEyes(ctx, v, cfg.eyeColor, eyeScale, 6.7 + xShift + headTurn * 0.8, 9.3 + xShift + headTurn * 0.8, 9.4)
}

const ALERT_CYCLE = 3.5

function drawWaiting(ctx: CanvasRenderingContext2D, v: V, cfg: MascotConfig, t: number): void {
  const cycle = t % ALERT_CYCLE
  const pct = cycle / ALERT_CYCLE
  const jumpY = lerp(
    [
      [0, 0], [0.03, 0], [0.1, -0.4], [0.15, 0.55],
      [0.175, -3.7], [0.2, -3.7], [0.25, 0.55],
      [0.275, -3.0], [0.3, -3.0], [0.35, 0.45],
      [0.375, -1.9], [0.4, -1.9], [0.45, 0.36],
      [0.475, -1.1], [0.5, -1.1], [0.55, 0.18],
      [0.62, 0], [1, 0],
    ],
    pct,
  )
  const landing = Math.max(0, jumpY)
  const shakeX = pct > 0.08 && pct < 0.62 ? Math.sin(pct * Math.PI * 18) * 0.55 : 0
  const eyeScale = pct > 0.03 && pct < 0.16 ? 1.16 : 1

  // 外圈 glow（呼吸）
  ctx.fillStyle = cfg.alertColor
  ctx.globalAlpha = 0.1 + Math.sin(t * Math.PI * 2) * 0.04
  ctx.beginPath()
  ctx.arc(v.x(8), v.y(9), 7.2 * v.s, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  drawBody(ctx, v, cfg, jumpY, 1 + landing * 0.08, 1 - landing * 0.05)
  drawEyes(ctx, v, cfg.eyeColor, eyeScale, 6.7 + shakeX * 0.5, 9.3 + shakeX * 0.5, 9.4)
  drawBang(ctx, v, cfg, pct)
}

const COMPLETE_CYCLE = 2.05

function drawCompleted(ctx: CanvasRenderingContext2D, v: V, cfg: MascotConfig, t: number): void {
  const cycle = t % COMPLETE_CYCLE
  const pct = cycle / COMPLETE_CYCLE
  const mascotPct = Math.min(1, pct / 0.58)
  const badgePct = Math.max(0, Math.min(1, (pct - 0.54) / 0.46))
  const jumpPhase = mascotPct * 3
  const jumpLocal = jumpPhase % 1
  const hop = -Math.sin(jumpLocal * Math.PI) * (2.05 + mascotPct * 0.55)
  const disappear = lerp([[0, 1], [0.78, 1], [1, 0]], mascotPct)
  const shrink = lerp([[0, 1], [0.78, 1], [1, 0.18]], mascotPct)

  if (mascotPct < 1) {
    ctx.globalAlpha = disappear
    drawBody(ctx, v, cfg, hop, shrink, shrink)
    drawEyes(ctx, v, cfg.eyeColor, 1.04, 6.7, 9.3, 9.4)
    ctx.globalAlpha = 1
  }
  if (badgePct > 0) {
    drawCompletionBadge(ctx, v, cfg, badgePct)
  }
}

// ===== 主入口 =====

export function drawMascot(
  ctx: CanvasRenderingContext2D,
  size: number,
  state: MascotState,
  t: number,
  cfg: MascotConfig = DEFAULT_MASCOT_CONFIG,
): void {
  const dpr = window.devicePixelRatio || 1
  ctx.clearRect(0, 0, size * dpr, size * dpr)
  ctx.save()
  ctx.scale(dpr, dpr)
  const v = new V(size)
  switch (state) {
    case 'idle':
      drawIdle(ctx, v, cfg, t)
      break
    case 'working':
      drawWorking(ctx, v, cfg, t)
      break
    case 'waiting':
      drawWaiting(ctx, v, cfg, t)
      break
    case 'completed':
      drawCompleted(ctx, v, cfg, t)
      break
  }
  ctx.restore()
}

/** 状态 → 颜色（pill 状态点用） */
export function mascotStateColor(state: MascotState): string {
  return MASCOT_STATE_COLORS[state]
}
