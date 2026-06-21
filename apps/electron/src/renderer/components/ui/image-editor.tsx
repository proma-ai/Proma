/**
 * ImageEditor - 轻量图片编辑器
 *
 * 基于 HTML5 Canvas，支持裁剪、旋转、自由绘制。
 * 在 ImageLightbox 编辑模式下使用。
 */

import * as React from 'react'
import { Crop, RotateCw, Pencil, Square, Undo2, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tool = 'crop' | 'rect' | 'draw' | 'none'

const DRAW_COLORS = ['#ff3b30', '#ffcc00', '#007aff', '#34c759', '#ff9500']
const BRUSH_SIZES = [3, 6]

interface ImageEditorProps {
  src: string
  onSave: (editedDataUrl: string) => void
  onCancel: () => void
}

export function ImageEditor({ src, onSave, onCancel }: ImageEditorProps): React.ReactElement {
  const [tool, setTool] = React.useState<Tool>('none')
  const [drawColor, setDrawColor] = React.useState('#ff3b30')
  const [brushSize, setBrushSize] = React.useState(3)
  const [rotation, setRotation] = React.useState(0)
  const [imageLoaded, setImageLoaded] = React.useState(false)
  const [imageError, setImageError] = React.useState(false)
  const [loadVersion, setLoadVersion] = React.useState(0)
  const [drawVersion, setDrawVersion] = React.useState(0)

  const displayCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const offscreenCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const drawCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const imgRef = React.useRef<HTMLImageElement | null>(null)

  const [cropRect, setCropRect] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const cropStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const cropRectRef = React.useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const isDrawingRef = React.useRef(false)
  const isMouseDownRef = React.useRef(false)
  const drawCtxRef = React.useRef<CanvasRenderingContext2D | null>(null)
  const checkerPatternRef = React.useRef<CanvasPattern | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const scaleRef = React.useRef(1)
  const displayDimRef = React.useRef({ w: 1, h: 1 })
  const rotationRef = React.useRef(0)

  // 同步 cropRect 到 ref，handleExport 可读取最新值
  React.useEffect(() => { cropRectRef.current = cropRect }, [cropRect])

  const MAX_DIM = 4096

  // 加载图片到离屏 canvas（src 不变时不会重置，避免闪烁）
  React.useEffect(() => {
    let cancelled = false
    setImageError(false)
    // 不 reset imageLoaded——同 src 重入时避免闪烁
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      imgRef.current = img
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h)
        w = Math.round(w * ratio)
        h = Math.round(h * ratio)
      }
      const offscreen = document.createElement('canvas')
      offscreen.width = w
      offscreen.height = h
      const ctx = offscreen.getContext('2d')
      if (!ctx) { console.error('ImageEditor: failed to get offscreen 2D context'); return }
      ctx.drawImage(img, 0, 0, w, h)
      offscreenCanvasRef.current = offscreen

      const drawLayer = document.createElement('canvas')
      drawLayer.width = w
      drawLayer.height = h
      drawCanvasRef.current = drawLayer
      const drawCtx = drawLayer.getContext('2d')
      if (!drawCtx) { console.error('ImageEditor: failed to get draw layer 2D context'); return }
      drawCtxRef.current = drawCtx

      setImageLoaded(true)
      setLoadVersion((v) => v + 1)
      rotationRef.current = 0
      setRotation(0)
      setCropRect(null)
    }
    img.onerror = () => {
      if (!cancelled) setImageError(true)
    }
    img.src = src
    return () => { cancelled = true }
  }, [src])

  // 渲染显示画布
  React.useEffect(() => {
    if (!imageLoaded) return
    const display = displayCanvasRef.current
    const offscreen = offscreenCanvasRef.current
    const drawLayer = drawCanvasRef.current
    if (!display || !offscreen || !drawLayer) return

    // 与预览 img 的 max-w-[90vw] max-h-[85vh] 完全一致
    // 用 clientWidth/clientHeight 匹配 CSS vw/vh（排除滚动条影响）
    const maxW = document.documentElement.clientWidth * 0.9
    const maxH = document.documentElement.clientHeight * 0.85

    let sw = offscreen.width
    let sh = offscreen.height
    // 应用旋转：90° 或 270° 时交换宽高
    const rotated = rotation % 180 !== 0
    const srcW = rotated ? sh : sw
    const srcH = rotated ? sw : sh

    const scale = Math.min(maxW / srcW, maxH / srcH, 1)
    scaleRef.current = scale
    const dw = Math.floor(srcW * scale)
    const dh = Math.floor(srcH * scale)
    displayDimRef.current = { w: dw, h: dh }
    const dpr = window.devicePixelRatio || 1
    display.width = Math.floor(dw * dpr)
    display.height = Math.floor(dh * dpr)
    display.style.width = `${dw}px`
    display.style.height = `${dh}px`

    const dCtx = display.getContext('2d')
    if (!dCtx) { console.error('ImageEditor: failed to get display 2D context'); return }
    // 绘制坐标系统一到 CSS 逻辑像素：dpr 由 transform 吸收，后续绘制与坐标换算无需感知 dpr
    dCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    dCtx.clearRect(0, 0, dw, dh)

    // 棋盘格背景（缓存 pattern canvas，避免每帧双循环）
    if (!checkerPatternRef.current) {
      const pCanvas = document.createElement('canvas')
      pCanvas.width = 16
      pCanvas.height = 16
      const pCtx = pCanvas.getContext('2d')
      if (pCtx) {
        pCtx.fillStyle = '#e0e0e0'
        pCtx.fillRect(0, 0, 8, 8)
        pCtx.fillRect(8, 8, 8, 8)
        pCtx.fillStyle = '#ffffff'
        pCtx.fillRect(8, 0, 8, 8)
        pCtx.fillRect(0, 8, 8, 8)
        checkerPatternRef.current = dCtx.createPattern(pCanvas, 'repeat')
      }
    }
    if (checkerPatternRef.current) {
      dCtx.fillStyle = checkerPatternRef.current
      dCtx.fillRect(0, 0, dw, dh)
    }

    dCtx.save()
    dCtx.scale(scale, scale)

    if (rotation !== 0) {
      const cx = srcW / 2
      const cy = srcH / 2
      dCtx.translate(cx, cy)
      dCtx.rotate((rotation * Math.PI) / 180)
      dCtx.translate(-sw / 2, -sh / 2)
    }

    dCtx.drawImage(offscreen, 0, 0)
    dCtx.drawImage(drawLayer, 0, 0)

    // 裁剪遮罩 + 矩形拖拽预览
    if ((tool === 'crop' || tool === 'rect') && cropRect) {
      const { x: rx, y: ry, w: rw, h: rh } = cropRect
      if (tool === 'crop') {
        // 裁剪：四边暗色覆盖
        dCtx.fillStyle = 'rgba(0,0,0,0.45)'
        if (ry > 0) dCtx.fillRect(0, 0, sw, ry)
        if (ry + rh < sh) dCtx.fillRect(0, ry + rh, sw, sh - ry - rh)
        if (rx > 0) dCtx.fillRect(0, ry, rx, rh)
        if (rx + rw < sw) dCtx.fillRect(rx + rw, ry, sw - rx - rw, rh)
      }
      // 共同：白色虚线边框
      dCtx.strokeStyle = '#fff'
      dCtx.lineWidth = 2 / scale
      dCtx.setLineDash([6 / scale, 3 / scale])
      dCtx.strokeRect(rx, ry, rw, rh)
      dCtx.setLineDash([])
    }
    dCtx.restore()
  }, [imageLoaded, rotation, cropRect, tool, drawVersion, loadVersion])

  // --- 工具操作 ---

  const handleRotate = React.useCallback(() => {
    setRotation((r) => {
      const next = (r + 90) % 360
      rotationRef.current = next
      return next
    })
    setCropRect(null)
  }, [])

  const applyCrop = React.useCallback(() => {
    if (!cropRect || !offscreenCanvasRef.current || !drawCanvasRef.current) return
    const offscreen = offscreenCanvasRef.current
    const drawLayer = drawCanvasRef.current
    const { x, y, w, h } = cropRect
    if (w < 4 || h < 4) return

    const newOffscreen = document.createElement('canvas')
    newOffscreen.width = w
    newOffscreen.height = h
    const ctx = newOffscreen.getContext('2d')
    if (!ctx) { console.error('ImageEditor: applyCrop failed to get 2D context'); return }
    ctx.drawImage(offscreen, x, y, w, h, 0, 0, w, h)
    ctx.drawImage(drawLayer, x, y, w, h, 0, 0, w, h)
    offscreenCanvasRef.current = newOffscreen

    const newDraw = document.createElement('canvas')
    newDraw.width = w
    newDraw.height = h
    drawCanvasRef.current = newDraw
    const newDrawCtx = newDraw.getContext('2d')
    if (!newDrawCtx) { console.error('ImageEditor: applyCrop failed to get new draw layer 2D context'); return }
    drawCtxRef.current = newDrawCtx

    setCropRect(null)
    cropRectRef.current = null
    // 保留当前旋转——裁剪区域在旋转后显示器上选中，截取后继续以原方向展示
    setTool('none')
  }, [cropRect])

  const handleExport = React.useCallback(() => {
    // 有未确认的裁剪选区 → 自动应用
    const pendingCrop = cropRectRef.current
    if (tool === 'crop' && pendingCrop && pendingCrop.w > 4 && pendingCrop.h > 4) {
      const offscreen = offscreenCanvasRef.current
      const drawLayer = drawCanvasRef.current
      if (offscreen && drawLayer) {
        const { x, y, w, h } = pendingCrop
        const newOffscreen = document.createElement('canvas')
        newOffscreen.width = w
        newOffscreen.height = h
        const nctx = newOffscreen.getContext('2d')
        if (nctx) {
          nctx.drawImage(offscreen, x, y, w, h, 0, 0, w, h)
          nctx.drawImage(drawLayer, x, y, w, h, 0, 0, w, h)
          offscreenCanvasRef.current = newOffscreen
          drawCanvasRef.current = document.createElement('canvas')
          drawCanvasRef.current.width = w
          drawCanvasRef.current.height = h
          cropRectRef.current = null
        }
      }
    }

    const offscreen = offscreenCanvasRef.current
    const drawLayer = drawCanvasRef.current
    if (!offscreen || !drawLayer) return

    const r = rotationRef.current
    const rotated = r % 180 !== 0
    const fw = rotated ? offscreen.height : offscreen.width
    const fh = rotated ? offscreen.width : offscreen.height

    const final = document.createElement('canvas')
    final.width = fw
    final.height = fh
    const ctx = final.getContext('2d')
    if (!ctx) { console.error('ImageEditor: handleExport failed to get 2D context'); return }

    if (r !== 0) {
      ctx.translate(fw / 2, fh / 2)
      ctx.rotate((r * Math.PI) / 180)
      ctx.translate(-offscreen.width / 2, -offscreen.height / 2)
    }
    ctx.drawImage(offscreen, 0, 0)
    ctx.drawImage(drawLayer, 0, 0)

    onSave(final.toDataURL('image/png'))
  }, [tool, onSave])

  const handleReset = React.useCallback(() => {
    if (!imgRef.current) return
    const img = imgRef.current
    let w = img.naturalWidth
    let h = img.naturalHeight
    if (w > MAX_DIM || h > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / w, MAX_DIM / h)
      w = Math.round(w * ratio)
      h = Math.round(h * ratio)
    }
    const offscreen = document.createElement('canvas')
    offscreen.width = w
    offscreen.height = h
    const ctx = offscreen.getContext('2d')
    if (!ctx) { console.error('ImageEditor: handleReset failed to get 2D context'); return }
    ctx.drawImage(img, 0, 0, w, h)
    offscreenCanvasRef.current = offscreen

    const drawLayer = document.createElement('canvas')
    drawLayer.width = w
    drawLayer.height = h
    drawCanvasRef.current = drawLayer
    const drawCtx = drawLayer.getContext('2d')
    if (!drawCtx) { console.error('ImageEditor: handleReset failed to get draw layer 2D context'); return }
    drawCtxRef.current = drawCtx

    setRotation(0)
    setCropRect(null)
    setTool('none')
  }, [])

  // --- 坐标转换（鼠标/触摸共用）---

  const getCanvasPos = React.useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = displayCanvasRef.current
    const offscreen = offscreenCanvasRef.current
    if (!canvas || !offscreen) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    let clientX: number
    let clientY: number
    if ('touches' in e) {
      const touch = e.touches[0]
      if (!touch) return { x: 0, y: 0 }
      clientX = touch.clientX
      clientY = touch.clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }
    const { w: bufW, h: bufH } = displayDimRef.current
    const bufX = (clientX - rect.left) * (bufW / rect.width)
    const bufY = (clientY - rect.top) * (bufH / rect.height)
    const s = scaleRef.current
    let sx = bufX / s
    let sy = bufY / s
    // 逆旋转：display 坐标 → offscreen 坐标
    const r = rotationRef.current
    if (r !== 0) {
      const sw = offscreen.width
      const sh = offscreen.height
      const rotDeg = r % 180 !== 0
      const srcW = rotDeg ? sh : sw
      const srcH = rotDeg ? sw : sh
      const cx = srcW / 2
      const cy = srcH / 2
      sx -= cx; sy -= cy
      const angle = -r * Math.PI / 180
      const cos = Math.cos(angle); const sin = Math.sin(angle)
      const rx = sx * cos - sy * sin
      const ry = sx * sin + sy * cos
      sx = rx + sw / 2; sy = ry + sh / 2
    }
    return { x: Math.max(0, Math.min(sx, offscreen.width)), y: Math.max(0, Math.min(sy, offscreen.height)) }
  }, [])

  // --- 鼠标事件 ---

  const handleMouseDown = React.useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isMouseDownRef.current = true
    if (tool === 'crop' || tool === 'rect') {
      const pos = getCanvasPos(e)
      cropStartRef.current = { x: pos.x, y: pos.y }
      setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 })
    } else if (tool === 'draw') {
      isDrawingRef.current = true
      const pos = getCanvasPos(e)
      const ctx = drawCtxRef.current
      if (ctx) {
        ctx.beginPath()
        ctx.moveTo(pos.x, pos.y)
        ctx.strokeStyle = drawColor
        ctx.lineWidth = brushSize
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
      }
    }
  }, [tool, getCanvasPos, drawColor, brushSize])

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if ((tool === 'crop' || tool === 'rect') && cropStartRef.current && isMouseDownRef.current) {
      const pos = getCanvasPos(e)
      const sx = cropStartRef.current.x
      const sy = cropStartRef.current.y
      setCropRect({
        x: Math.min(sx, pos.x),
        y: Math.min(sy, pos.y),
        w: Math.abs(pos.x - sx),
        h: Math.abs(pos.y - sy),
      })
    } else if (tool === 'draw' && isDrawingRef.current) {
      const pos = getCanvasPos(e)
      const ctx = drawCtxRef.current
      if (ctx) {
        ctx.lineTo(pos.x, pos.y)
        ctx.stroke()
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            setDrawVersion((v) => v + 1)
          })
        }
      }
    }
  }, [tool, getCanvasPos])

  const handleMouseUp = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    isMouseDownRef.current = false
    if (tool === 'rect' && cropRect && cropRect.w > 2 && cropRect.h > 2) {
      const ctx = drawCtxRef.current
      if (ctx) {
        ctx.strokeStyle = drawColor
        ctx.lineWidth = brushSize
        ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h)
      }
    }
    setDrawVersion((v) => v + 1)
    isDrawingRef.current = false
    if (tool !== 'crop') {
      cropStartRef.current = null
      if (tool === 'rect') setCropRect(null)
    }
  }, [tool, cropRect, drawColor, brushSize])

  // --- 触摸事件 ---

  const handleTouchStart = React.useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    isMouseDownRef.current = true
    if (tool === 'crop' || tool === 'rect') {
      const pos = getCanvasPos(e)
      cropStartRef.current = { x: pos.x, y: pos.y }
      setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 })
    } else if (tool === 'draw') {
      isDrawingRef.current = true
      const pos = getCanvasPos(e)
      const ctx = drawCtxRef.current
      if (ctx) {
        ctx.beginPath()
        ctx.moveTo(pos.x, pos.y)
        ctx.strokeStyle = drawColor
        ctx.lineWidth = brushSize
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
      }
    }
  }, [tool, getCanvasPos, drawColor, brushSize])

  const handleTouchMove = React.useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if ((tool === 'crop' || tool === 'rect') && cropStartRef.current && isMouseDownRef.current) {
      const pos = getCanvasPos(e)
      const sx = cropStartRef.current.x
      const sy = cropStartRef.current.y
      setCropRect({
        x: Math.min(sx, pos.x),
        y: Math.min(sy, pos.y),
        w: Math.abs(pos.x - sx),
        h: Math.abs(pos.y - sy),
      })
    } else if (tool === 'draw' && isDrawingRef.current) {
      const pos = getCanvasPos(e)
      const ctx = drawCtxRef.current
      if (ctx) {
        ctx.lineTo(pos.x, pos.y)
        ctx.stroke()
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            setDrawVersion((v) => v + 1)
          })
        }
      }
    }
  }, [tool, getCanvasPos])

  const handleTouchEnd = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    isMouseDownRef.current = false
    if (tool === 'rect' && cropRect && cropRect.w > 2 && cropRect.h > 2) {
      const ctx = drawCtxRef.current
      if (ctx) {
        ctx.strokeStyle = drawColor
        ctx.lineWidth = brushSize
        ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h)
      }
    }
    setDrawVersion((v) => v + 1)
    isDrawingRef.current = false
    if (tool !== 'crop') {
      cropStartRef.current = null
      if (tool === 'rect') setCropRect(null)
    }
  }, [tool, cropRect, drawColor, brushSize])

  if (!src) return <div className="flex flex-col items-center gap-3 text-white/50"><span className="text-sm">无图片数据</span><button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-sm bg-white/10 hover:bg-white/20 transition-colors">返回</button></div>

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-[90vw]">
      {/* 显示画布 — 尺寸与预览 img 完全一致 */}
      <div className="relative flex items-center justify-center">
        {imageError && (
          <div className="flex flex-col items-center gap-3 text-white/50">
            <span className="text-sm">图片加载失败</span>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full px-4 py-1.5 text-sm bg-white/10 hover:bg-white/20 transition-colors"
            >
              返回
            </button>
          </div>
        )}
        {!imageError && !imageLoaded && (
          <div className="w-[200px] h-[150px]" />
        )}
        <canvas
          ref={displayCanvasRef}
          className={cn(
            'rounded-lg shadow-2xl select-none touch-none',
            tool === 'crop' && 'cursor-crosshair',
            tool === 'rect' && 'cursor-crosshair',
            tool === 'draw' && 'cursor-crosshair',
            !imageLoaded && 'hidden'
          )}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>

      {/* 下方工具栏 — 工具 + 操作合并为一个悬浮岛 */}
      <div className={cn(
        'flex items-center gap-1 rounded-full',
        'bg-black/50 backdrop-blur-md shadow-lg',
        'px-3 py-2.5'
      )}>
        {/* 裁剪 */}
        <button
          type="button"
          onClick={() => { setTool(tool === 'crop' ? 'none' : 'crop'); setCropRect(null); cropStartRef.current = null }}
          className={cn(
            'rounded-full p-2 text-white/70 transition-colors duration-150',
            'hover:bg-white/15 hover:text-white',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            tool === 'crop' && 'bg-white/20 text-white'
          )}
          title="裁剪"
        >
          <Crop className="size-5" />
        </button>

        {/* 旋转 */}
        <button
          type="button"
          onClick={handleRotate}
          className={cn(
            'rounded-full p-2 text-white/70 transition-colors duration-150',
            'hover:bg-white/15 hover:text-white',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
          )}
          title="旋转 90°"
        >
          <RotateCw className="size-5" />
        </button>

        {/* 矩形（默认绘制工具） */}
        <button
          type="button"
          onClick={() => setTool(tool === 'rect' ? 'none' : 'rect')}
          className={cn(
            'rounded-full p-2 text-white/70 transition-colors duration-150',
            'hover:bg-white/15 hover:text-white',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            tool === 'rect' && 'bg-white/20 text-white'
          )}
          title="矩形"
        >
          <Square className="size-5" />
        </button>

        {/* 画笔 */}
        <button
          type="button"
          onClick={() => setTool(tool === 'draw' ? 'none' : 'draw')}
          className={cn(
            'rounded-full p-2 text-white/70 transition-colors duration-150',
            'hover:bg-white/15 hover:text-white',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            tool === 'draw' && 'bg-white/20 text-white'
          )}
          title="画笔"
        >
          <Pencil className="size-5" />
        </button>

        {/* 绘制颜色 + 笔触（矩形和画笔共用） */}
        {(tool === 'draw' || tool === 'rect') && (
          <>
            <div className="mx-0.5 h-5 w-px bg-white/20" aria-hidden />
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDrawColor(c)}
                className={cn(
                  'size-[22px] rounded-full border-2 transition-transform',
                  drawColor === c ? 'border-white scale-110' : 'border-transparent'
                )}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            {BRUSH_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setBrushSize(s)}
                className={cn(
                  'rounded-full flex items-center justify-center text-white/70 transition-colors size-[22px]',
                  'hover:bg-white/15',
                  brushSize === s ? 'bg-white/20 text-white' : ''
                )}
                title={`笔触 ${s}px`}
              >
                <span
                  className="rounded-full bg-current"
                  style={{ width: Math.max(4, s * 1.2), height: Math.max(4, s * 1.2) }}
                />
              </button>
            ))}
          </>
        )}

        {/* 裁剪时显示应用按钮 */}
        {tool === 'crop' && cropRect && cropRect.w > 4 && cropRect.h > 4 && (
          <>
            <div className="mx-0.5 h-5 w-px bg-white/20" aria-hidden />
            <button
              type="button"
              onClick={applyCrop}
              className={cn(
                'rounded-full p-2 text-[#34c759] transition-colors duration-150',
                'hover:bg-white/15',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
              )}
              title="应用裁剪"
            >
              <Check className="size-5" />
            </button>
          </>
        )}

        <div className="mx-1.5 h-5 w-px bg-white/20" aria-hidden />

        {/* 重置 */}
        <button
          type="button"
          onClick={handleReset}
          className={cn(
            'rounded-full p-2 text-white/70 transition-colors duration-150',
            'hover:bg-white/15 hover:text-white',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
          )}
          title="重置"
        >
          <Undo2 className="size-5" />
        </button>

        {/* 取消 */}
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'rounded-full p-2 text-white/70 transition-colors duration-150',
            'hover:bg-white/15 hover:text-white',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
          )}
          title="取消"
        >
          <X className="size-5" />
        </button>

        {/* 保存 */}
        <button
          type="button"
          onClick={handleExport}
          disabled={!imageLoaded}
          className={cn(
            'rounded-full px-3 py-2 text-sm font-medium',
            'bg-white/15 text-white hover:bg-white/25',
            'transition-colors duration-150',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            !imageLoaded && 'opacity-40 cursor-not-allowed hover:bg-white/15'
          )}
        >
          保存
        </button>
      </div>
    </div>
  )
}
