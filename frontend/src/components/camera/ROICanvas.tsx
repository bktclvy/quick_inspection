import { useRef, useEffect, useCallback } from 'react'
import type { ROI } from '../../types'

/* ── Helpers ──────────────────────────────────────── */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const HANDLE_SIZE = 7
const MIN_ROI = 0.03

type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type HandlePos = Record<HandleName, { x: number; y: number }>

function getHandlePositions(x: number, y: number, w: number, h: number): HandlePos {
  return {
    nw: { x, y }, ne: { x: x + w, y }, sw: { x, y: y + h }, se: { x: x + w, y: y + h },
    n: { x: x + w / 2, y }, s: { x: x + w / 2, y: y + h },
    w: { x, y: y + h / 2 }, e: { x: x + w, y: y + h / 2 },
  }
}

const HANDLE_CURSORS: Record<HandleName, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize',
}

interface DragState {
  roiId: string
  type: 'move' | 'resize'
  handle: HandleName | null
  startNorm: { x: number; y: number }
  origROI: { x: number; y: number; w: number; h: number }
}

/* ── Props ────────────────────────────────────────── */

export interface ROIResult {
  roi_id: string
  judgment: string  // 'ok' | 'ng' | 'OK' | 'NG'
}

export interface ROICanvasProps {
  /** The MJPEG <img> element to overlay on */
  imgEl: HTMLImageElement | null
  rois: ROI[]
  readOnly?: boolean
  editMode?: boolean
  /** Test/inspection results — colors ROI borders green/red */
  results?: ROIResult[]
  /** Called when a new ROI is drawn. Parent should prompt for name and call API. */
  onDrawComplete?: (rect: { x: number; y: number; w: number; h: number }) => void
  /** Called after a ROI is moved or resized. Parent should call API to save. */
  onROIUpdate?: (roiId: string, rect: { x: number; y: number; w: number; h: number }) => void
  /** Called when edit mode should be disabled after a draw */
  onEditModeExit?: () => void
}

/* ── Component ────────────────────────────────────── */

export function ROICanvas({
  imgEl,
  rois,
  readOnly = false,
  editMode = false,
  results,
  onDrawComplete,
  onROIUpdate,
  onEditModeExit,
}: ROICanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const isDrawingRef = useRef(false)
  const hoveredRef = useRef<{ roiId: string | null; handle: HandleName | null }>({ roiId: null, handle: null })

  // Deep copy of rois for drag operations (avoid mutating store objects)
  const roisRef = useRef<ROI[]>([])
  // Only update when not dragging to avoid overwriting drag-in-progress state
  if (!dragRef.current) {
    roisRef.current = rois.map((r) => ({ ...r }))
  }
  const resultsRef = useRef<ROIResult[] | undefined>(undefined)
  resultsRef.current = results

  /* ── Resize canvas to match img ──────────────── */

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgEl) return
    const imgRect = imgEl.getBoundingClientRect()
    const container = canvas.parentElement
    if (!container) return
    const containerRect = container.getBoundingClientRect()

    const left = imgRect.left - containerRect.left
    const top = imgRect.top - containerRect.top

    canvas.style.left = `${left}px`
    canvas.style.top = `${top}px`
    canvas.style.width = `${imgRect.width}px`
    canvas.style.height = `${imgRect.height}px`
    canvas.width = imgRect.width
    canvas.height = imgRect.height
  }, [imgEl])

  /* ── Drawing ────────────────────────────────── */

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cw = canvas.width
    const ch = canvas.height
    ctx.clearRect(0, 0, cw, ch)

    for (const roi of roisRef.current) {
      const isHovered = hoveredRef.current.roiId === roi.id
      const x = roi.x * cw, y = roi.y * ch
      const w = roi.w * cw, h = roi.h * ch

      // 判定結果がある場合は色を変える
      const result = resultsRef.current?.find((r) => r.roi_id === roi.id)
      const color = result
        ? (result.judgment.toLowerCase() === 'ok' ? '#10b981' : '#ef4444')
        : (roi.color || '#1d4ed8')

      ctx.save()

      // Rectangle
      ctx.strokeStyle = color
      ctx.lineWidth = result ? 3 : 2
      ctx.strokeRect(x, y, w, h)

      // Result fill (OK=green tint, NG=red tint) — no text, just border + fill
      if (result) {
        ctx.fillStyle = color
        ctx.globalAlpha = 0.15
        ctx.fillRect(x, y, w, h)
        ctx.globalAlpha = 1
      }

      // Hover fill
      if (isHovered && !editMode && !result) {
        ctx.fillStyle = color
        ctx.globalAlpha = 0.08
        ctx.fillRect(x, y, w, h)
        ctx.globalAlpha = 1
      }

      // Label
      const label = roi.name || roi.id
      ctx.font = `600 11px 'DM Sans', sans-serif`
      const tw = ctx.measureText(label).width
      ctx.fillStyle = color
      ctx.globalAlpha = 0.85
      ctx.fillRect(x, y - 18, tw + 10, 18)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#fff'
      ctx.fillText(label, x + 5, y - 5)

      // Template marker
      if (roi.has_template) {
        ctx.fillStyle = '#059669'
        ctx.beginPath()
        ctx.arc(x + w - 8, y + 8, 4, 0, Math.PI * 2)
        ctx.fill()
      }

      // Resize handles
      if (!readOnly && !editMode) {
        const handles = getHandlePositions(x, y, w, h)
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        for (const pos of Object.values(handles)) {
          ctx.beginPath()
          ctx.rect(pos.x - HANDLE_SIZE / 2, pos.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
          ctx.fill()
          ctx.stroke()
        }
      }

      ctx.restore()
    }
  }, [readOnly, editMode, results])

  /* ── Hit testing ────────────────────────────── */

  const eventToNorm = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }, [])

  const hitTestHandle = useCallback((px: number, py: number): { roiId: string; handle: HandleName } | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const cw = canvas.width, ch = canvas.height
    const hs = HANDLE_SIZE + 3
    for (const roi of roisRef.current) {
      const handles = getHandlePositions(roi.x * cw, roi.y * ch, roi.w * cw, roi.h * ch)
      for (const [name, pos] of Object.entries(handles)) {
        if (Math.abs(px - pos.x) <= hs && Math.abs(py - pos.y) <= hs) {
          return { roiId: roi.id, handle: name as HandleName }
        }
      }
    }
    return null
  }, [])

  const hitTestROI = useCallback((px: number, py: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const cw = canvas.width, ch = canvas.height
    for (let i = roisRef.current.length - 1; i >= 0; i--) {
      const roi = roisRef.current[i]
      const x = roi.x * cw, y = roi.y * ch, w = roi.w * cw, h = roi.h * ch
      if (px >= x && px <= x + w && py >= y && py <= y + h) return roi.id
    }
    return null
  }, [])

  /* ── Mouse handlers ─────────────────────────── */

  const onMouseDown = useCallback((e: MouseEvent) => {
    const norm = eventToNorm(e)
    const canvas = canvasRef.current!
    const px = norm.x * canvas.width, py = norm.y * canvas.height

    if (editMode && !readOnly) {
      isDrawingRef.current = true
      drawStartRef.current = { x: norm.x, y: norm.y }
      return
    }
    if (readOnly) return

    const handle = hitTestHandle(px, py)
    if (handle) {
      const roi = roisRef.current.find((r) => r.id === handle.roiId)
      if (roi) {
        dragRef.current = {
          roiId: roi.id, type: 'resize', handle: handle.handle,
          startNorm: norm, origROI: { x: roi.x, y: roi.y, w: roi.w, h: roi.h },
        }
        e.preventDefault()
        return
      }
    }

    const roiId = hitTestROI(px, py)
    if (roiId) {
      const roi = roisRef.current.find((r) => r.id === roiId)
      if (roi) {
        dragRef.current = {
          roiId: roi.id, type: 'move', handle: null,
          startNorm: norm, origROI: { x: roi.x, y: roi.y, w: roi.w, h: roi.h },
        }
        e.preventDefault()
      }
    }
  }, [editMode, readOnly, eventToNorm, hitTestHandle, hitTestROI])

  const onMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const norm = eventToNorm(e)
    const px = norm.x * canvas.width, py = norm.y * canvas.height

    // Drawing new ROI
    if (isDrawingRef.current && editMode) {
      drawAll()
      const ctx = canvas.getContext('2d')!
      const cw = canvas.width, ch = canvas.height
      const s = drawStartRef.current!
      ctx.strokeStyle = '#d97706'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(s.x * cw, s.y * ch, (norm.x - s.x) * cw, (norm.y - s.y) * ch)
      ctx.setLineDash([])
      return
    }

    // Dragging (move/resize)
    const ds = dragRef.current
    if (ds) {
      const dx = norm.x - ds.startNorm.x, dy = norm.y - ds.startNorm.y
      const roi = roisRef.current.find((r) => r.id === ds.roiId)
      if (!roi) return

      if (ds.type === 'move') {
        roi.x = clamp01(ds.origROI.x + dx)
        roi.y = clamp01(ds.origROI.y + dy)
        if (roi.x + roi.w > 1) roi.x = 1 - roi.w
        if (roi.y + roi.h > 1) roi.y = 1 - roi.h
      } else if (ds.type === 'resize' && ds.handle) {
        applyResize(roi, ds as DragState & { handle: HandleName }, dx, dy)
      }
      drawAll()
      return
    }

    // Hover
    if (readOnly || editMode) return
    const prevHovered = hoveredRef.current.roiId
    const handle = hitTestHandle(px, py)
    if (handle) {
      canvas.style.cursor = HANDLE_CURSORS[handle.handle]
      hoveredRef.current = { roiId: handle.roiId, handle: handle.handle }
    } else {
      const roiId = hitTestROI(px, py)
      if (roiId) {
        canvas.style.cursor = 'move'
        hoveredRef.current = { roiId, handle: null }
      } else {
        canvas.style.cursor = ''
        hoveredRef.current = { roiId: null, handle: null }
      }
    }
    if (prevHovered !== hoveredRef.current.roiId) drawAll()
  }, [editMode, readOnly, eventToNorm, hitTestHandle, hitTestROI, drawAll])

  const onMouseUp = useCallback((e: MouseEvent) => {
    const norm = eventToNorm(e)

    // Finished drawing new ROI
    if (isDrawingRef.current && editMode) {
      isDrawingRef.current = false
      const s = drawStartRef.current!
      const x = Math.min(s.x, norm.x), y = Math.min(s.y, norm.y)
      const w = Math.abs(norm.x - s.x), h = Math.abs(norm.y - s.y)

      if (w >= MIN_ROI && h >= MIN_ROI) {
        onDrawComplete?.({ x, y, w, h })
        onEditModeExit?.()
      }
      drawAll()
      return
    }

    // Finished drag
    const ds = dragRef.current
    if (ds) {
      const roi = roisRef.current.find((r) => r.id === ds.roiId)
      dragRef.current = null
      if (roi) {
        const o = ds.origROI
        if (roi.x !== o.x || roi.y !== o.y || roi.w !== o.w || roi.h !== o.h) {
          onROIUpdate?.(roi.id, { x: roi.x, y: roi.y, w: roi.w, h: roi.h })
        }
      }
      drawAll()
    }
  }, [editMode, eventToNorm, drawAll, onDrawComplete, onROIUpdate, onEditModeExit])

  /* ── Effects ─────────────────────────────────── */

  // ResizeObserver
  useEffect(() => {
    if (!imgEl) return
    resizeCanvas()
    const ro = new ResizeObserver(resizeCanvas)
    ro.observe(imgEl)
    return () => ro.disconnect()
  }, [imgEl, resizeCanvas])

  // Mouse event listeners
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseup', onMouseUp)
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseDown, onMouseMove, onMouseUp])

  // Redraw when rois change
  useEffect(() => {
    resizeCanvas()
    drawAll()
  }, [rois, drawAll, resizeCanvas])

  // Pointer events
  const pointerEvents = editMode ? 'auto' : (!readOnly && rois.length > 0) ? 'auto' : 'none'
  const cursor = editMode ? 'crosshair' : undefined

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        pointerEvents,
        cursor,
        zIndex: 5,
      }}
    />
  )
}

/* ── Resize calculation ───────────────────────────── */

function applyResize(
  roi: ROI,
  ds: DragState & { handle: HandleName },
  dx: number,
  dy: number,
) {
  const o = ds.origROI
  let nx = o.x, ny = o.y, nw = o.w, nh = o.h
  const h = ds.handle

  if (h === 'w' || h === 'nw' || h === 'sw') {
    nx = clamp01(o.x + dx)
    nw = o.w - (nx - o.x)
    if (nw < MIN_ROI) { nw = MIN_ROI; nx = o.x + o.w - MIN_ROI }
  } else if (h === 'e' || h === 'ne' || h === 'se') {
    nw = Math.max(MIN_ROI, o.w + dx)
    if (nx + nw > 1) nw = 1 - nx
  }

  if (h === 'n' || h === 'nw' || h === 'ne') {
    ny = clamp01(o.y + dy)
    nh = o.h - (ny - o.y)
    if (nh < MIN_ROI) { nh = MIN_ROI; ny = o.y + o.h - MIN_ROI }
  } else if (h === 's' || h === 'sw' || h === 'se') {
    nh = Math.max(MIN_ROI, o.h + dy)
    if (ny + nh > 1) nh = 1 - ny
  }

  roi.x = nx; roi.y = ny; roi.w = nw; roi.h = nh
}
