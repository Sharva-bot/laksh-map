'use client'
import { useEffect, useRef, useState } from 'react'

export function CobaltSprite() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        width: 88,
        height: 88,
        zIndex: 9999,
        pointerEvents: 'none',
        borderRadius: '50%',
        overflow: 'hidden',
        background: '#1400F6',
        boxShadow: '0 2px 12px rgba(20,0,246,0.3)',
      }}
    >
      <canvas ref={canvasRef} width={88} height={88} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}
