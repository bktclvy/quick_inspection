import { useCallback, useRef } from 'react'

type SoundType = 'ok' | 'ng' | 'capture' | 'tare_ok' | 'box_ok' | 'box_ng'

const audioCtxRef = { current: null as AudioContext | null }

function getCtx(): AudioContext {
  if (!audioCtxRef.current) {
    audioCtxRef.current = new AudioContext()
  }
  return audioCtxRef.current
}

function playOk() {
  const ctx = getCtx()
  const t = ctx.currentTime
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.3, t + i * 0.12)
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.1)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + i * 0.12)
    osc.stop(t + i * 0.12 + 0.1)
  }
}

function playNg() {
  const ctx = getCtx()
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sawtooth'
  osc.frequency.value = 220
  gain.gain.setValueAtTime(0.3, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.35)
}

function playTareOk() {
  const ctx = getCtx()
  const t = ctx.currentTime
  for (const [freq, delay] of [[523, 0], [659, 0.1], [784, 0.2]] as [number, number][]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.22, t + delay)
    gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.25)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + delay)
    osc.stop(t + delay + 0.25)
  }
}

function playBoxOk() {
  const ctx = getCtx()
  const t = ctx.currentTime
  for (const [freq, delay] of [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.26]] as [number, number][]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.28, t + delay)
    gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + delay)
    osc.stop(t + delay + 0.3)
  }
}

function playBoxNg() {
  const ctx = getCtx()
  const t = ctx.currentTime
  for (const [freq, delay] of [[330, 0], [220, 0.22]] as [number, number][]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.32, t + delay)
    gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.45)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + delay)
    osc.stop(t + delay + 0.45)
  }
}

function playCapture() {
  const ctx = getCtx()
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = 1200
  gain.gain.setValueAtTime(0.15, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.05)
}

export function useAudioFeedback() {
  const lastRef = useRef(0)

  const play = useCallback((type: SoundType) => {
    const now = Date.now()
    if (now - lastRef.current < 80) return
    lastRef.current = now

    switch (type) {
      case 'ok': playOk(); break
      case 'ng': playNg(); break
      case 'capture': playCapture(); break
      case 'tare_ok': playTareOk(); break
      case 'box_ok': playBoxOk(); break
      case 'box_ng': playBoxNg(); break
    }
  }, [])

  return { play }
}
