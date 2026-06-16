import { useEffect, useRef } from 'react'
import KoiFish from './KoiFish'

export default function KoiScene() {
  const mouseRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2, active: false })

  useEffect(() => {
    const onMove = (e) => {
      mouseRef.current = { x: e.clientX, y: e.clientY, active: true }
    }
    const onTouch = (e) => {
      e.preventDefault()
      const t = e.touches[0]
      if (t) mouseRef.current = { x: t.clientX, y: t.clientY, active: true }
    }
    const onTouchEnd = () => {
      mouseRef.current = { ...mouseRef.current, active: false }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchstart', onTouch, { passive: false })
    window.addEventListener('touchmove', onTouch, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchstart', onTouch)
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      <KoiFish mouseRef={mouseRef} />
    </div>
  )
}
