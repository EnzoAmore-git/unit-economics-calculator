import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

interface TooltipProps {
  text: string
}

interface Position {
  top: number
  left: number
  below: boolean
}

const GAP = 8
const WIDTH = 256

export default function Tooltip({ text }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<Position | null>(null)

  const show = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const center = rect.left + rect.width / 2
    const left = Math.min(
      Math.max(center, WIDTH / 2 + GAP),
      window.innerWidth - WIDTH / 2 - GAP,
    )
    const below = rect.top - GAP < 100
    const top = below ? rect.bottom + GAP : rect.top - GAP
    setPosition({ top, left, below })
  }

  const hide = () => setPosition(null)

  useEffect(() => {
    if (!position) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [position])

  return (
    <span
      ref={triggerRef}
      className="group relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <HelpCircle
        className="h-3.5 w-3.5 cursor-help text-cyan-400/70 transition-colors hover:text-cyan-400"
        aria-hidden="true"
      />
      {position &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[100] rounded-lg border border-cyan-500/40 bg-slate-900 p-3 text-left text-xs leading-relaxed text-slate-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]"
            style={{
              width: WIDTH,
              top: position.top,
              left: position.left,
              transform: `translate(-50%, ${position.below ? '0' : '-100%'})`,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}
