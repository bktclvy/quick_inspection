import { useRef, useCallback, useEffect } from 'react'

interface CameraFeedProps {
  onImgRef?: (img: HTMLImageElement) => void
  className?: string
}

/**
 * MJPEG camera stream. Renders just the <img> and flash overlay.
 * Parent must provide a positioned container for the ROICanvas sibling.
 */
export function CameraFeed({ onImgRef, className }: CameraFeedProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)

  const handleLoad = useCallback(() => {
    if (imgRef.current && onImgRef) {
      onImgRef(imgRef.current)
    }
  }, [onImgRef])

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__cameraFlash = () => {
      const el = flashRef.current
      if (!el) return
      el.style.opacity = '0.7'
      setTimeout(() => { el.style.opacity = '0' }, 60)
    }
    return () => {
      delete (window as unknown as Record<string, unknown>).__cameraFlash
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
  const fn = (window as unknown as Record<string, unknown>).__cameraFlash
  if (typeof fn === 'function') (fn as () => void)()
}
