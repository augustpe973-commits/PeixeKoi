import { useEffect, useRef } from 'react'
import KoiFish from './KoiFish'

export default function KoiScene() {
  const mouseRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  useEffect(() => {
    const onMove = (e) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      <KoiFish mouseRef={mouseRef} />
    </div>
  )
}
