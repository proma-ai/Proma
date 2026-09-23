/** 一次性散花的初始粒子参数；位置与速度使用 CSS 像素、秒。 */
export interface ConfettiParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  angle: number
  spin: number
  delay: number
  life: number
  color: string
}

const COLORS = ['#f4c46a', '#e99283', '#82b7a6', '#8795ce', '#ddabd1', '#f5dfaa']

export function createPurchaseConfetti(
  width: number,
  height: number,
  random: () => number = Math.random,
): ConfettiParticle[] {
  const particles: ConfettiParticle[] = []
  for (const side of [1, -1]) {
    for (let i = 0; i < 90; i++) {
      const r = random()
      particles.push({
        x: side === 1 ? r * width * 0.1 : width * (1 - r * 0.1),
        y: height * (0.93 + random() * 0.07),
        vx: side * width * (0.13 + random() * 0.37),
        vy: -height * (1.2 + random() * 0.6),
        size: 4 + random() * 7,
        angle: random() * Math.PI * 2,
        spin: (random() - 0.5) * 12,
        delay: random() * 0.4,
        life: 2 + random() * 1.5,
        color: COLORS[Math.floor(random() * COLORS.length)] ?? COLORS[0]!,
      })
    }
  }
  return particles
}
