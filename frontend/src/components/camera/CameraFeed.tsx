import { useRef, useCallback, useEffect } from 'react'

interface CameraFeedProps {
  onImgRef?: (img: HTMLImageElement) => void
  className?: string
}

// カメラフラッシュ用のグローバルコールバック型
declare global {
  interface Window {
    __cameraFlash?: () => void
  }
}

/**
 * MJPEG camera stream. Renders just the <img> and flash overlay.
 * Parent must provide a positioned container for the ROICanvas sibling.
 */
export function CameraFeed({ onImgRef, className }: CameraFeedProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)

  // imgRefが設定されたら即座にonImgRefを呼ぶ（onLoadを待たない）
  useEffect(() => {
    if (imgRef.current && onImgRef) {
      onImgRef(imgRef.current)
    }
  }, [onImgRef])

  // onLoadでも念のため呼ぶ
  const handleLoad = useCallback(() => {
    if (imgRef.current && onImgRef) {
      onImgRef(imgRef.current)
    }
  }, [onImgRef])

  useEffect(() => {
    window.__cameraFlash = () => {
      const el = flashRef.current
      if (!el) return
      el.style.opacity = '0.7'
      setTimeout(() => { el.style.opacity = '0' }, 60)
    }
    return () => {
      delete window.__cameraFlash
    }
  }, [])

  return (
    <>
      <img
        ref={imgRef}
        className={`camera-img ${className ?? ''}`}
        src="/stream"
        onLoad={handleLoad}
        alt="Camera"
      />
      <div ref={flashRef} className="camera-flash" />
    </>
  )
}

export function triggerFlash() {
  window.__cameraFlash?.()
}
