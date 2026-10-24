import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { useLanguage } from '../lib/i18n/LanguageContext'

// Finger / pen / mouse signature (0084). Always black ink on white, so the saved PNG prints the same in dark mode.
function SignaturePad({ onChange, label }: { onChange: (dataUrl: string | null) => void; label: string }) {
  const { t } = useLanguage()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const drawn = useRef(false)

  function clear() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawn.current = false
    onChange(null)
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    // Capped at 2x: sharp on tablets, and the PNG stays well under the 0084 size check.
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = canvas.clientWidth * scale
    canvas.height = canvas.clientHeight * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#000'
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- size once on mount
  }, [])

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top] as const
  }

  function start(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = e.currentTarget.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(...point(e))
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = e.currentTarget.getContext('2d')!
    ctx.lineTo(...point(e))
    ctx.stroke()
    drawn.current = true
  }

  function end(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    drawing.current = false
    if (drawn.current) onChange(e.currentTarget.toDataURL('image/png'))
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button type="button" className="secondary-button" onClick={clear}>
        {t('waivers.clearSignature')}
      </button>
    </div>
  )
}

export default SignaturePad
