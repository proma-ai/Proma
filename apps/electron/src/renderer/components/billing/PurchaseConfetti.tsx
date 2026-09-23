import * as React from 'react'
import { createPortal } from 'react-dom'
import { createPurchaseConfetti } from './purchase-confetti'

/** 一次性覆盖整个 App 窗口，不截获任何点击。 */
export function PurchaseConfetti(): React.ReactElement | null {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = React.useState(true)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motionPreference.matches || document.hidden) {
      setVisible(false)
      return
    }

    const context = canvas.getContext('2d')
    if (!context) return

    let width = window.innerWidth
    let height = window.innerHeight
    let particles = createPurchaseConfetti(width, height)
    let start = performance.now()
    let frame = 0
    const resize = (): void => {
      width = window.innerWidth
      height = window.innerHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      particles = createPurchaseConfetti(width, height)
      start = performance.now()
    }
    const reduceMotion = (): void => {
      if (motionPreference.matches) setVisible(false)
    }
    resize()
    window.addEventListener('resize', resize)
    motionPreference.addEventListener('change', reduceMotion)

    const draw = (now: number): void => {
      const elapsed = (now - start) / 1000
      context.clearRect(0, 0, width, height)
      for (const particle of particles) {
        const t = elapsed - particle.delay
        if (t < 0 || t > particle.life) continue
        const fade = Math.min(1, (particle.life - t) / 0.55)
        const x = particle.x + particle.vx * t
        const y = particle.y + particle.vy * t + 0.5 * height * 1.55 * t * t
        context.save()
        context.translate(x, y)
        context.rotate(particle.angle + particle.spin * t)
        context.fillStyle = particle.color
        context.globalAlpha = fade
        context.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.66)
        context.restore()
      }
      if (elapsed < 3.9) {
        frame = requestAnimationFrame(draw)
      } else {
        setVisible(false)
      }
    }

    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      motionPreference.removeEventListener('change', reduceMotion)
    }
  }, [])

  if (!visible || typeof document === 'undefined') return null
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100] h-screen w-screen"
    />,
    document.body,
  )
}
