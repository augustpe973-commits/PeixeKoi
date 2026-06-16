import { useEffect, useRef } from 'react'

const FISH_LEN = 400
const NJ       = 18
const SEG      = FISH_LEN / (NJ - 1)
const MAX_BEND = 0.20

const lerp      = (a, b, t) => a + (b - a) * t
const clamp     = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const angleDiff = (a, b) => {
  let d = b - a
  while (d >  Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

// ── Body profile — fusiform, widest right after the head (anatomically correct) ──
function bodyHW(t) {
  const pts = [
    [0.00, 46],   // head — narrower snout
    [0.04, 49],
    [0.10, 55],
    [0.18, 64],   // MAXIMUM — shoulder
    [0.30, 62],   // upper trunk still wide
    [0.44, 52],   // beginning taper
    [0.58, 38],   // significant taper
    [0.70, 24],   // caudal peduncle transition
    [0.80, 15],   // peduncle
    [0.88, 8],    // narrow peduncle
    [0.94, 4],
    [1.00, 2],
  ]
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, w0] = pts[i - 1], [t1, w1] = pts[i]
      return w0 + (w1 - w0) * (t - t0) / (t1 - t0)
    }
  }
  return 2
}

function updateJoints(joints, headX, headY) {
  joints[0].x = headX
  joints[0].y = headY
  for (let i = 1; i < joints.length; i++) {
    const dx = joints[i].x - joints[i - 1].x
    const dy = joints[i].y - joints[i - 1].y
    let angle = Math.atan2(dy, dx)
    if (i >= 2) {
      const pdx = joints[i - 1].x - joints[i - 2].x
      const pdy = joints[i - 1].y - joints[i - 2].y
      const prev = Math.atan2(pdy, pdx)
      angle = prev + clamp(angleDiff(prev, angle), -MAX_BEND, MAX_BEND)
    }
    joints[i].x = joints[i - 1].x + Math.cos(angle) * SEG
    joints[i].y = joints[i - 1].y + Math.sin(angle) * SEG
  }
}

function buildSpine(joints, wave) {
  return joints.map((j, i) => {
    const t   = i / (NJ - 1)
    const amp = t < 0.50 ? 0 : Math.pow((t - 0.50) / 0.50, 1.5) * 30
    const ia  = Math.min(i + 1, NJ - 1), ib = Math.max(i - 1, 0)
    const fdx = joints[ia].x - joints[ib].x, fdy = joints[ia].y - joints[ib].y
    const fl  = Math.hypot(fdx, fdy) || 1
    const lat = Math.sin(wave - t * Math.PI * 1.8) * amp
    return { x: j.x + (-fdy / fl) * lat, y: j.y + (fdx / fl) * lat, hw: bodyHW(t), t }
  })
}

function jDir(pts, i) {
  const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)]
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1
  return { dx: dx / l, dy: dy / l }
}

function catmullPath(ctx, pts, move) {
  if (pts.length < 2) return
  move ? ctx.moveTo(pts[0].x, pts[0].y) : ctx.lineTo(pts[0].x, pts[0].y)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i]
    const p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)]
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 8, p1.y + (p2.y - p0.y) / 8,
      p2.x - (p3.x - p1.x) / 8, p2.y - (p3.y - p1.y) / 8,
      p2.x, p2.y,
    )
  }
}

function catmullClosed(ctx, pts) {
  const n = pts.length
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i]
    const p2 = pts[(i + 1) % n],     p3 = pts[(i + 2) % n]
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
      p2.x, p2.y,
    )
  }
  ctx.closePath()
}

function buildEdges(spine) {
  const L = [], R = []
  for (let i = 0; i < spine.length; i++) {
    const { x, y, hw } = spine[i], d = jDir(spine, i)
    L.push({ x: x - d.dy * hw, y: y + d.dx * hw })
    R.push({ x: x + d.dy * hw, y: y - d.dx * hw })
  }
  const smooth = (pts) => pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p
    const a = pts[i - 1], b = pts[i + 1]
    return { x: a.x * 0.25 + p.x * 0.50 + b.x * 0.25, y: a.y * 0.25 + p.y * 0.50 + b.y * 0.25 }
  })
  const multiSmooth = (pts) => { let r = pts; for (let i = 0; i < 2; i++) r = smooth(r); return r }
  return { L: multiSmooth(L), R: multiSmooth(R) }
}

function applyBodyPath(ctx, spine, { L, R }) {
  const h  = spine[0], hw0 = spine[0].hw
  const d0 = jDir(spine, 0), sa = Math.atan2(-d0.dy, -d0.dx)
  ctx.beginPath()
  ctx.moveTo(L[0].x, L[0].y)
  if (L.length >= 2) {
    const seg = Math.hypot(L[1].x - L[0].x, L[1].y - L[0].y) / 8
    const p3  = L[Math.min(2, L.length - 1)]
    ctx.bezierCurveTo(
      L[0].x + d0.dx * seg,         L[0].y + d0.dy * seg,
      L[1].x - (p3.x - L[0].x) / 8, L[1].y - (p3.y - L[0].y) / 8,
      L[1].x, L[1].y,
    )
  }
  for (let i = 1; i < L.length - 1; i++) {
    const p0 = L[i-1], p1 = L[i], p2 = L[i+1], p3 = L[Math.min(i+2, L.length-1)]
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 8, p1.y + (p2.y - p0.y) / 8,
      p2.x - (p3.x - p1.x) / 8, p2.y - (p3.y - p1.y) / 8,
      p2.x, p2.y,
    )
  }
  catmullPath(ctx, R.slice().reverse(), false)
  ctx.arc(h.x, h.y, hw0, sa + Math.PI / 2, sa - Math.PI / 2, true)
  ctx.closePath()
}

function localToWorld(spine, ji, pts) {
  const sp = spine[ji], d = jDir(spine, ji)
  const a = Math.atan2(d.dy, d.dx), cA = Math.cos(a), sA = Math.sin(a)
  return pts.map(([ox, oy]) => ({
    x: sp.x + ox * cA - oy * sA,
    y: sp.y + ox * sA + oy * cA,
  }))
}

function edgePt(spine, ji, side) {
  const sp = spine[ji], d = jDir(spine, ji)
  return { x: sp.x + side * d.dy * sp.hw, y: sp.y - side * d.dx * sp.hw }
}

// ── Water ─────────────────────────────────────────────────────────────────
function drawWater(ctx, W, H, t) {
  ctx.fillStyle = '#050A12'
  ctx.fillRect(0, 0, W, H)
  ctx.save()

  // Ambient depth blobs
  for (let i = 0; i < 7; i++) {
    const bx = (Math.sin(t * 0.31 + i * 1.05) * 0.42 + 0.5) * W
    const by = (Math.cos(t * 0.26 + i * 0.78) * 0.42 + 0.5) * H
    const r  = 85 + Math.sin(t * 0.53 + i * 1.2) * 28
    const g  = ctx.createRadialGradient(bx, by, 0, bx, by, r)
    g.addColorStop(0, 'rgba(35,90,140,0.06)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill()
  }

  // Water surface caustics — light refraction shimmer
  for (let i = 0; i < 10; i++) {
    const cx = (Math.sin(t * 0.13 + i * 1.88) * 0.44 + 0.5) * W
    const cy = (Math.cos(t * 0.16 + i * 1.44) * 0.44 + 0.5) * H
    const cr = 48 + Math.sin(t * 0.72 + i * 0.91) * 18
    const pulse = 0.022 + Math.sin(t * 1.4 + i * 0.7) * 0.010
    ctx.globalAlpha = pulse
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr)
    cg.addColorStop(0,   'rgba(110,195,255,0.55)')
    cg.addColorStop(0.55,'rgba(40,120,190,0.18)')
    cg.addColorStop(1,   'rgba(0,0,0,0)')
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill()
  }

  // Gentle water surface lines — slow drifting curves
  ctx.globalAlpha = 0.032
  ctx.strokeStyle = '#4A8AAA'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 6; i++) {
    const yBase = (Math.sin(t * 0.09 + i * 1.1) * 0.35 + 0.5) * H
    ctx.beginPath()
    ctx.moveTo(0, yBase + Math.sin(t * 0.15 + i) * 22)
    ctx.bezierCurveTo(
      W * 0.32, yBase - 14 + Math.sin(t * 0.19 + i * 0.6) * 10,
      W * 0.66, yBase + 14 + Math.sin(t * 0.21 + i * 0.8) * 10,
      W,        yBase + Math.sin(t * 0.17 + i * 1.2) * 18
    )
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

// ── Speed wake — fading trail behind the fish ─────────────────────────────
function drawWake(ctx, trail, speed) {
  if (trail.length < 3) return
  ctx.save()
  for (let i = 1; i < trail.length; i++) {
    const a0 = trail[i - 1], a1 = trail[i]
    const frac  = 1 - i / trail.length
    const alpha = frac * frac * 0.055 * clamp(speed * 0.55, 0.3, 1.0)
    if (alpha < 0.003) continue
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#2A5C8E'
    ctx.lineWidth   = frac * 7 + 1.5
    ctx.lineCap     = 'round'
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// ── Shadow ────────────────────────────────────────────────────────────────
function drawShadow(ctx, spine) {
  const OX = 12, OY = 9
  const L = [], R = []
  for (let i = 0; i < spine.length; i++) {
    const { x, y, hw } = spine[i], d = jDir(spine, i)
    L.push({ x: x + OX - d.dy * hw * 0.85, y: y + OY + d.dx * hw * 0.85 })
    R.push({ x: x + OX + d.dy * hw * 0.85, y: y + OY - d.dx * hw * 0.85 })
  }
  const h  = spine[0], hw0 = spine[0].hw * 0.85
  const d0 = jDir(spine, 0), sa = Math.atan2(-d0.dy, -d0.dx)
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.filter      = 'blur(7px)'
  ctx.beginPath()
  catmullPath(ctx, L, true)
  catmullPath(ctx, R.slice().reverse(), false)
  ctx.arc(h.x + OX, h.y + OY, hw0, sa + Math.PI / 2, sa - Math.PI / 2, false)
  ctx.closePath()
  ctx.fillStyle = '#000'; ctx.fill()
  ctx.restore()
}

// ── Fan fin — scalloped petals + bone rays ────────────────────────────────
function drawFanFin(ctx, root, centerAngle, LEN, SPREAD, RAYS, envFn, sag) {
  const a0  = centerAngle - SPREAD / 2
  const a1  = centerAngle + SPREAD / 2
  const env = envFn || ((f) => 0.06 + 0.94 * Math.sin(f * Math.PI))
  const SAG = sag !== undefined ? sag : 0.93

  ctx.save()
  for (let r = 0; r < RAYS; r++) {
    const fr0 = r / RAYS,         fr1 = (r + 1) / RAYS
    const frM = (fr0 + fr1) * 0.5
    const ra0 = lerp(a0, a1, fr0), ra1 = lerp(a0, a1, fr1), raM = lerp(a0, a1, frM)
    const rl0 = LEN * env(fr0),    rl1 = LEN * env(fr1)
    const rlM = LEN * env(frM) * SAG

    const x0 = root.x + Math.cos(ra0) * rl0, y0 = root.y + Math.sin(ra0) * rl0
    const x1 = root.x + Math.cos(ra1) * rl1, y1 = root.y + Math.sin(ra1) * rl1
    const xM = root.x + Math.cos(raM) * rlM, yM = root.y + Math.sin(raM) * rlM

    const g = ctx.createLinearGradient(root.x, root.y, xM, yM)
    g.addColorStop(0,    'rgba(245,238,224,0.94)')
    g.addColorStop(0.30, 'rgba(228,220,204,0.72)')
    g.addColorStop(0.68, 'rgba(208,200,182,0.38)')
    g.addColorStop(1,    'rgba(180,172,154,0.08)')

    ctx.beginPath()
    ctx.moveTo(root.x, root.y)
    ctx.lineTo(x0, y0)
    ctx.quadraticCurveTo(xM, yM, x1, y1)
    ctx.closePath()
    ctx.fillStyle = g; ctx.fill()
  }

  for (let r = 0; r <= RAYS; r++) {
    const fr = r / RAYS, ra = lerp(a0, a1, fr), rl = LEN * env(fr)
    if (rl < 6) continue
    ctx.beginPath()
    ctx.moveTo(root.x + Math.cos(ra) * 13, root.y + Math.sin(ra) * 13)
    ctx.lineTo(root.x + Math.cos(ra) * rl, root.y + Math.sin(ra) * rl)
    ctx.strokeStyle = r === 0 || r === RAYS ? 'rgba(75,62,48,0.85)' : 'rgba(92,80,62,0.60)'
    ctx.lineWidth   = r === 0 || r === RAYS ? 1.20 : 0.78
    ctx.stroke()
  }
  ctx.restore()
}

// ── Caudal accents — delicate small fans at the peduncle before main tail ──
function drawCaudalAccents(ctx, spine, wave) {
  const sw = Math.sin(wave * 0.9) * 0.08

  // Two wispy accent fans — one on each side of peduncle (spine 14 & 15)
  for (const [ji, side] of [[14, -1], [14, 1], [15, -1], [15, 1]]) {
    if (!spine[ji]) continue
    const pt = spine[ji]
    const d  = jDir(spine, ji)
    const ba = Math.atan2(d.dy, d.dx)
    const LEN    = ji === 14 ? 62 : 42
    const SPREAD = 0.55
    const RAYS   = 9
    const fc = ba + side * (Math.PI * 0.52) + sw * side
    const a0 = fc - SPREAD, a1 = fc + SPREAD
    const root = { x: pt.x + side * d.dy * pt.hw * 0.7, y: pt.y - side * d.dx * pt.hw * 0.7 }
    const env = (f) => 0.10 + 0.90 * Math.sin(f * Math.PI)

    ctx.save()
    for (let r = 0; r < RAYS; r++) {
      const fr0=r/RAYS, fr1=(r+1)/RAYS, frM=(fr0+fr1)*0.5
      const ra0=lerp(a0,a1,fr0), ra1=lerp(a0,a1,fr1), raM=lerp(a0,a1,frM)
      const rl0=LEN*env(fr0), rl1=LEN*env(fr1), rlM=LEN*env(frM)*0.88
      const x0=root.x+Math.cos(ra0)*rl0, y0=root.y+Math.sin(ra0)*rl0
      const x1=root.x+Math.cos(ra1)*rl1, y1=root.y+Math.sin(ra1)*rl1
      const xM=root.x+Math.cos(raM)*rlM, yM=root.y+Math.sin(raM)*rlM
      const g=ctx.createLinearGradient(root.x,root.y,xM,yM)
      g.addColorStop(0,   'rgba(238,234,220,0.80)')
      g.addColorStop(0.40,'rgba(218,212,196,0.52)')
      g.addColorStop(0.75,'rgba(194,186,168,0.20)')
      g.addColorStop(1,   'rgba(164,156,138,0.02)')
      ctx.beginPath(); ctx.moveTo(root.x,root.y); ctx.lineTo(x0,y0)
      ctx.quadraticCurveTo(xM,yM,x1,y1); ctx.closePath()
      ctx.fillStyle=g; ctx.fill()
    }
    for (let r = 0; r <= RAYS; r++) {
      const fr=r/RAYS, ra=lerp(a0,a1,fr), rl=LEN*env(fr)
      if (rl < 6) continue
      ctx.beginPath()
      ctx.moveTo(root.x+Math.cos(ra)*7, root.y+Math.sin(ra)*7)
      ctx.lineTo(root.x+Math.cos(ra)*rl, root.y+Math.sin(ra)*rl)
      ctx.strokeStyle = r===0||r===RAYS ? 'rgba(80,68,52,0.50)' : 'rgba(96,84,66,0.28)'
      ctx.lineWidth   = r===0||r===RAYS ? 0.90 : 0.50
      ctx.stroke()
    }
    ctx.restore()
  }
}

// ── Caudal fin — two large elegant forked lobes ───────────────────────────
function drawCaudal(ctx, spine, wave) {
  const tip  = spine[NJ - 1]
  const base = spine[NJ - 5]  // further back = more stable direction vector
  const ta   = Math.atan2(tip.y - base.y, tip.x - base.x)
  const sw   = Math.sin(wave) * 0.14

  // ── Central lobe — straight back, narrower, slightly transparent ──────
  {
    const LEN = 170, SPREAD = 0.30, RAYS = 14, SAG = 0.87
    const fc = ta + sw * 0.4
    const a0 = fc - SPREAD, a1 = fc + SPREAD
    const env = (f) => 0.08 + 0.92 * Math.sin(f * Math.PI)
    ctx.save()
    for (let r = 0; r < RAYS; r++) {
      const fr0=r/RAYS, fr1=(r+1)/RAYS, frM=(fr0+fr1)*0.5
      const ra0=lerp(a0,a1,fr0), ra1=lerp(a0,a1,fr1), raM=lerp(a0,a1,frM)
      const rl0=LEN*env(fr0), rl1=LEN*env(fr1), rlM=LEN*env(frM)*SAG
      const x0=tip.x+Math.cos(ra0)*rl0, y0=tip.y+Math.sin(ra0)*rl0
      const x1=tip.x+Math.cos(ra1)*rl1, y1=tip.y+Math.sin(ra1)*rl1
      const xM=tip.x+Math.cos(raM)*rlM, yM=tip.y+Math.sin(raM)*rlM
      const g=ctx.createLinearGradient(tip.x,tip.y,xM,yM)
      g.addColorStop(0,   'rgba(238,234,222,0.88)')
      g.addColorStop(0.35,'rgba(220,214,200,0.65)')
      g.addColorStop(0.72,'rgba(198,190,174,0.28)')
      g.addColorStop(1,   'rgba(168,160,144,0.04)')
      ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(x0,y0)
      ctx.quadraticCurveTo(xM,yM,x1,y1); ctx.closePath()
      ctx.fillStyle=g; ctx.fill()
    }
    for (let r = 0; r <= RAYS; r++) {
      const fr=r/RAYS, ra=lerp(a0,a1,fr), rl=LEN*env(fr)
      if (rl < 8) continue
      ctx.beginPath()
      ctx.moveTo(tip.x+Math.cos(ra)*10, tip.y+Math.sin(ra)*10)
      ctx.lineTo(tip.x+Math.cos(ra)*rl,  tip.y+Math.sin(ra)*rl)
      ctx.strokeStyle = r===0||r===RAYS ? 'rgba(72,62,48,0.60)' : 'rgba(88,78,62,0.36)'
      ctx.lineWidth   = r===0||r===RAYS ? 1.0 : 0.58
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Intermediate lobes — fill the gap between main and central ──────────
  for (const sign of [-1, 1]) {
    const LEN = 185, SPREAD = 0.40, RAYS = 14, SAG = 0.88
    const fc = ta + sign * 0.30 + sw * sign * 0.6
    const a0 = fc - SPREAD, a1 = fc + SPREAD
    const env = (f) => 0.09 + 0.91 * Math.sin(f * Math.PI)
    ctx.save()
    for (let r = 0; r < RAYS; r++) {
      const fr0=r/RAYS, fr1=(r+1)/RAYS, frM=(fr0+fr1)*0.5
      const ra0=lerp(a0,a1,fr0), ra1=lerp(a0,a1,fr1), raM=lerp(a0,a1,frM)
      const rl0=LEN*env(fr0), rl1=LEN*env(fr1), rlM=LEN*env(frM)*SAG
      const x0=tip.x+Math.cos(ra0)*rl0, y0=tip.y+Math.sin(ra0)*rl0
      const x1=tip.x+Math.cos(ra1)*rl1, y1=tip.y+Math.sin(ra1)*rl1
      const xM=tip.x+Math.cos(raM)*rlM, yM=tip.y+Math.sin(raM)*rlM
      const g=ctx.createLinearGradient(tip.x,tip.y,xM,yM)
      g.addColorStop(0,   'rgba(240,236,224,0.82)')
      g.addColorStop(0.32,'rgba(226,220,206,0.62)')
      g.addColorStop(0.68,'rgba(204,196,180,0.26)')
      g.addColorStop(1,   'rgba(174,166,150,0.04)')
      ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(x0,y0)
      ctx.quadraticCurveTo(xM,yM,x1,y1); ctx.closePath()
      ctx.fillStyle=g; ctx.fill()
    }
    for (let r = 0; r <= RAYS; r++) {
      const fr=r/RAYS, ra=lerp(a0,a1,fr), rl=LEN*env(fr)
      if (rl < 8) continue
      ctx.beginPath()
      ctx.moveTo(tip.x+Math.cos(ra)*10, tip.y+Math.sin(ra)*10)
      ctx.lineTo(tip.x+Math.cos(ra)*rl,  tip.y+Math.sin(ra)*rl)
      ctx.strokeStyle = r===0||r===RAYS ? 'rgba(72,62,48,0.55)' : 'rgba(88,78,62,0.32)'
      ctx.lineWidth   = r===0||r===RAYS ? 1.0 : 0.55
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Main lobes ──────────────────────────────────────────────────────────
  for (const sign of [-1, 1]) {
    const LEN    = 230
    const SPREAD = 0.88
    const RAYS   = 24
    const SAG    = 0.90
    const fc     = ta + sign * 0.62 + sw * sign  // more closed V
    const a0     = fc - SPREAD, a1 = fc + SPREAD
    const env    = (f) => 0.10 + 0.90 * Math.sin(f * Math.PI)  // thicker base

    ctx.save()
    for (let r = 0; r < RAYS; r++) {
      const fr0 = r / RAYS, fr1 = (r + 1) / RAYS, frM = (fr0 + fr1) * 0.5
      const ra0 = lerp(a0, a1, fr0), ra1 = lerp(a0, a1, fr1), raM = lerp(a0, a1, frM)
      const rl0 = LEN * env(fr0), rl1 = LEN * env(fr1), rlM = LEN * env(frM) * SAG
      const x0 = tip.x + Math.cos(ra0) * rl0, y0 = tip.y + Math.sin(ra0) * rl0
      const x1 = tip.x + Math.cos(ra1) * rl1, y1 = tip.y + Math.sin(ra1) * rl1
      const xM = tip.x + Math.cos(raM) * rlM, yM = tip.y + Math.sin(raM) * rlM
      const g = ctx.createLinearGradient(tip.x, tip.y, xM, yM)
      g.addColorStop(0,    'rgba(242,238,228,0.98)')
      g.addColorStop(0.30, 'rgba(230,224,212,0.90)')
      g.addColorStop(0.62, 'rgba(210,202,188,0.56)')
      g.addColorStop(1,    'rgba(182,174,158,0.10)')
      ctx.beginPath()
      ctx.moveTo(tip.x, tip.y)
      ctx.lineTo(x0, y0)
      ctx.quadraticCurveTo(xM, yM, x1, y1)
      ctx.closePath()
      ctx.fillStyle = g; ctx.fill()
    }
    for (let r = 0; r <= RAYS; r++) {
      const fr = r / RAYS, ra = lerp(a0, a1, fr), rl = LEN * env(fr)
      ctx.beginPath()
      ctx.moveTo(tip.x + Math.cos(ra) * 11, tip.y + Math.sin(ra) * 11)
      ctx.lineTo(tip.x + Math.cos(ra) * rl,  tip.y + Math.sin(ra) * rl)
      ctx.strokeStyle = r === 0 || r === RAYS ? 'rgba(78,68,54,0.82)' : 'rgba(96,86,70,0.55)'
      ctx.lineWidth   = r === 0 || r === RAYS ? 1.30 : 0.78
      ctx.stroke()
    }
    ctx.restore()
  }
}

// t=1 = pointed tip. Geometry:
//   side= 1: outward = ba-PI/2. Rotating CW toward tail (ba) = increasing angle.
//            Tip (t=1) must be at a1 (larger angle) → t = f.
//   side=-1: outward = ba+PI/2. Rotating CCW toward tail (ba) = decreasing angle.
//            Tip (t=1) must be at a0 (smaller angle) → t = 1-f.
function triSweptEnv(side) {
  return (f) => {
    const t = side === 1 ? f : (1 - f)
    if (t < 0.52) return 0.10 + 0.90 * (t / 0.52)
    return 1.0 - ((t - 0.52) / 0.48) * 0.97
  }
}

// Center angle = outward-perpendicular tilted PI/4 toward tail:
//   (ba - side*PI/2) rotated ±PI/4 toward ba  =  ba - side*(PI/2 - PI/4) = ba - side*PI*0.25
// For ba=45° fish: side=1 → fc=0°, fan 320°→40°, tip at 40° ≈ tail(45°) ✓
//                  side=-1 → fc=90°, fan 50°→130°, tip at 50° ≈ tail(45°) ✓
function drawPectorals(ctx, spine, wave, fold) {
  for (const [ji, side] of [[5, -1], [5, 1]]) {
    if (!spine[ji]) continue
    const d  = jDir(spine, ji)
    const ba = Math.atan2(d.dy, d.dx)
    const sw = Math.sin(wave * 0.5 + 1.1) * 0.06
    const fc = ba - side * (Math.PI * 0.25) + sw
    drawFanFin(ctx, edgePt(spine, ji, side), fc, 155, Math.PI * 0.44, 13, triSweptEnv(side), 0.97)
  }
}

function drawPelvics(ctx, spine, wave, fold) {
  for (const [ji, side] of [[11, -1], [11, 1]]) {
    if (!spine[ji]) continue
    const d  = jDir(spine, ji)
    const ba = Math.atan2(d.dy, d.dx)
    const sw = Math.sin(wave * 0.5 + 2.4) * 0.05
    const fc = ba - side * (Math.PI * 0.25) + sw
    drawFanFin(ctx, edgePt(spine, ji, side), fc, 85, Math.PI * 0.40, 11, triSweptEnv(side), 0.97)
  }
}

// ── Dorsal fin — elegant triangular sail with translucent membrane ──────────
function drawDorsal(ctx, spine, phase) {
  const S = 3, E = 11
  const ridgePts = [], basePts = []

  for (let i = S; i <= E; i++) {
    const pt = spine[i]; if (!pt) continue
    const d  = jDir(spine, i)
    const pr = (i - S) / (E - S)
    const hh = Math.sin(pr * Math.PI) * 46 * (0.78 + 0.22 * Math.sin(phase + i * 0.85))
    ridgePts.push({ x: pt.x - d.dy * (hh + 3), y: pt.y + d.dx * (hh + 3) })
    basePts.push(  { x: pt.x - d.dy * 3,        y: pt.y + d.dx * 3 })
  }
  if (ridgePts.length < 2) return

  const mid  = ridgePts[Math.floor(ridgePts.length / 2)]
  const base0 = basePts[0]

  ctx.save()
  ctx.beginPath()
  catmullPath(ctx, basePts, true)
  catmullPath(ctx, ridgePts.slice().reverse(), false)
  ctx.closePath()

  const g = ctx.createLinearGradient(base0.x, base0.y, mid.x, mid.y)
  g.addColorStop(0,    'rgba(215,205,188,0.96)')
  g.addColorStop(0.38, 'rgba(194,183,164,0.78)')
  g.addColorStop(0.70, 'rgba(170,160,140,0.42)')
  g.addColorStop(1,    'rgba(140,130,112,0.08)')
  ctx.fillStyle = g; ctx.fill()
  ctx.strokeStyle = 'rgba(100,90,74,0.44)'; ctx.lineWidth = 0.85; ctx.stroke()

  // Bone rays — emanating from base, thin and elegant
  for (let k = 0; k < ridgePts.length; k++) {
    const b = basePts[k], r = ridgePts[k]
    ctx.beginPath()
    ctx.moveTo(b.x + (r.x - b.x) * 0.08, b.y + (r.y - b.y) * 0.08)
    ctx.lineTo(r.x, r.y)
    ctx.strokeStyle = k === 0 || k === ridgePts.length - 1
      ? 'rgba(88,78,62,0.68)' : 'rgba(100,90,74,0.50)'
    ctx.lineWidth = k === 0 || k === ridgePts.length - 1 ? 1.0 : 0.72
    ctx.stroke()
  }
  ctx.restore()
}

// ── Operculum (gill cover) — subtle arc on each side right behind head ─────
function drawOperculum(ctx, spine) {
  if (!spine[1] || !spine[2]) return
  // Use joint 1 as the operculum center (between head and body)
  const p  = spine[1], d = jDir(spine, 1)
  const hw = p.hw

  ctx.save()
  ctx.strokeStyle = 'rgba(105,88,70,0.30)'
  ctx.lineWidth   = 1.5
  ctx.lineCap     = 'round'

  for (const side of [-1, 1]) {
    // Edge attachment point
    const ex = p.x + side * d.dy * hw, ey = p.y - side * d.dx * hw
    // Control: curves inward and slightly backward (toward tail)
    const cx = p.x + side * d.dy * hw * 0.28 + d.dx * hw * 0.18
    const cy = p.y - side * d.dx * hw * 0.28 + d.dy * hw * 0.18
    // Inner end: on the dorsal centerline, slightly behind head
    const ix = p.x + d.dx * hw * 0.10, iy = p.y + d.dy * hw * 0.10

    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.quadraticCurveTo(cx, cy, ix, iy)
    ctx.stroke()
  }
  ctx.restore()
}

// ── Barbilhões (4 whiskers at the mouth, two pairs) ───────────────────────
function drawBarbels(ctx, spine) {
  if (!spine[0]) return
  const h  = spine[0], d0 = jDir(spine, 0)
  const sa = Math.atan2(-d0.dy, -d0.dx)  // forward (toward snout)
  const hw = h.hw

  // 4 barbels: 2 maxillary (longer, at mouth corners) + 2 rostral (shorter, at snout)
  const defs = [
    { ao: -0.38, rf: 0.84, bDir: sa - 0.62, bLen: 22 },  // left maxillary
    { ao:  0.38, rf: 0.84, bDir: sa + 0.62, bLen: 22 },  // right maxillary
    { ao: -0.16, rf: 0.96, bDir: sa - 0.30, bLen: 14 },  // left rostral
    { ao:  0.16, rf: 0.96, bDir: sa + 0.30, bLen: 14 },  // right rostral
  ]

  ctx.save()
  ctx.strokeStyle = 'rgba(165,140,108,0.84)'
  ctx.lineWidth   = 1.3
  ctx.lineCap     = 'round'

  defs.forEach(({ ao, rf, bDir, bLen }) => {
    const attachA = sa + ao
    const sx = h.x + Math.cos(attachA) * hw * rf
    const sy = h.y + Math.sin(attachA) * hw * rf
    const ex = sx + Math.cos(bDir) * bLen
    const ey = sy + Math.sin(bDir) * bLen
    const cx = sx + Math.cos(bDir + 0.18) * bLen * 0.48
    const cy = sy + Math.sin(bDir + 0.18) * bLen * 0.48

    ctx.beginPath(); ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke()
  })
  ctx.restore()
}

// ── Lateral line — subtle sensory organ marking ────────────────────────────
function drawLateralLine(ctx, spine) {
  ctx.save()
  for (let i = 2; i < NJ - 3; i++) {
    const pt = spine[i], d = jDir(spine, i)
    const fade = Math.sin((i / (NJ - 5)) * Math.PI)  // fade in/out at ends
    for (const side of [-1, 1]) {
      const lx = pt.x + side * d.dy * pt.hw * 0.52
      const ly = pt.y - side * d.dx * pt.hw * 0.52
      ctx.globalAlpha = 0.22 * fade
      ctx.fillStyle = '#8A7258'
      ctx.beginPath(); ctx.arc(lx, ly, 1.4, 0, Math.PI * 2); ctx.fill()
      // Small sensory pore ring
      ctx.globalAlpha = 0.10 * fade
      ctx.strokeStyle = '#6A5438'; ctx.lineWidth = 0.6
      ctx.beginPath(); ctx.arc(lx, ly, 2.6, 0, Math.PI * 2); ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// ── Body + Patches — flat Sanke/Showa colour pattern ──────────────────────
// Pattern follows reference: orange hi first, then black sumi on top.
function drawBodyAndPatches(ctx, spine) {
  const edges = buildEdges(spine)

  // Drop shadow
  ctx.save()
  applyBodyPath(ctx, spine, edges)
  ctx.shadowColor = 'rgba(0,0,0,0.32)'; ctx.shadowBlur = 26
  ctx.fillStyle   = '#FFFFFF'; ctx.fill()
  ctx.restore()

  // White body base — warm ivory
  applyBodyPath(ctx, spine, edges)
  ctx.fillStyle = '#F8F4EE'; ctx.fill()

  ctx.save()
  applyBodyPath(ctx, spine, edges)
  ctx.clip()

  const _c = pts => { let x=0,y=0; pts.forEach(p=>{x+=p.x;y+=p.y}); return {x:x/pts.length,y:y/pts.length} }
  const _r = (pts,c) => pts.reduce((m,p)=>Math.max(m,Math.hypot(p.x-c.x,p.y-c.y)),0)

  const hi = pts => {
    const c = _c(pts), r = _r(pts,c)
    const g = ctx.createRadialGradient(c.x-r*0.18, c.y-r*0.22, r*0.04, c.x+r*0.06, c.y+r*0.10, r*1.05)
    g.addColorStop(0,   '#FFE040')
    g.addColorStop(0.4, '#E8B010')
    g.addColorStop(0.8, '#C08A06')
    g.addColorStop(1,   'rgba(148,100,4,0)')
    ctx.save(); ctx.filter='blur(5px)'
    ctx.beginPath(); catmullClosed(ctx,pts); ctx.fillStyle=g; ctx.fill()
    ctx.restore()
  }

  const sumi = pts => {
    const c = _c(pts), r = _r(pts,c)
    const g = ctx.createRadialGradient(c.x-r*0.10, c.y-r*0.14, 0, c.x, c.y, r)
    g.addColorStop(0,   '#1ACEE0')
    g.addColorStop(0.5, '#0898AC')
    g.addColorStop(0.85,'#056878')
    g.addColorStop(1,   '#033E4A')
    ctx.save(); ctx.filter='blur(2.5px)'
    ctx.beginPath(); catmullClosed(ctx,pts); ctx.fillStyle=g; ctx.fill()
    ctx.restore()
  }

  // ── Hi patches ──────────────────────────────────────────────────────────
  hi(localToWorld(spine, 2, [
    [-50,-62],[-72,-44],[-84,-16],[-82,18],[-68,48],[-44,64],
    [-16,68],[14,60],[38,40],[52,12],[50,-20],[34,-46],[10,-60],[-20,-66]
  ]))
  hi(localToWorld(spine, 6, [
    [-44,-14],[-30,-42],[-8,-52],[18,-48],[40,-28],[48,2],[40,30],
    [18,46],[-10,48],[-34,32],[-46,4]
  ]))
  hi(localToWorld(spine, 9, [
    [-38,-8],[-24,-34],[-2,-42],[22,-36],[38,-12],[36,18],
    [18,36],[-4,40],[-24,28],[-36,4]
  ]))
  hi(localToWorld(spine, 12, [
    [-22,-4],[-14,-20],[2,-28],[16,-22],[24,0],[18,20],[2,28],[-14,20],[-22,2]
  ]))
  hi(localToWorld(spine, 15, [
    [-8,-4],[-4,-12],[6,-14],[12,-6],[14,6],[8,12],[0,14],[-8,6]
  ]))

  // ── Sumi patches ────────────────────────────────────────────────────────
  sumi(localToWorld(spine, 3, [
    [-14,-30],[-2,-40],[16,-38],[28,-20],[30,4],[20,26],[2,34],[-16,28],[-24,6],[-18,-18]
  ]))
  sumi(localToWorld(spine, 5, [
    [-28,-10],[-16,-36],[2,-46],[22,-44],[38,-24],[44,0],[36,26],
    [16,42],[-6,44],[-26,30],[-36,8]
  ]))
  sumi(localToWorld(spine, 8, [
    [-18,-28],[-4,-38],[14,-34],[26,-14],[26,10],[14,28],[-4,32],[-20,20],[-24,0],[-18,-20]
  ]))
  sumi(localToWorld(spine, 11, [
    [-20,-6],[-12,-22],[4,-30],[18,-22],[24,-2],[18,18],[4,26],[-12,18],[-20,0]
  ]))
  sumi(localToWorld(spine, 14, [
    [-8,-14],[-2,-20],[10,-18],[16,-6],[14,8],[4,16],[-8,12],[-14,0],[-10,-10]
  ]))

  // Cycloid scale texture
  ctx.globalAlpha = 0.072
  ctx.strokeStyle = '#8A9A80'; ctx.lineWidth = 0.70
  for (let i = 2; i < NJ - 3; i += 2) {
    const pt = spine[i], d = jDir(spine, i)
    const a = Math.atan2(d.dy, d.dx), hw = pt.hw
    for (const sf of [-0.46, -0.15, 0.15, 0.46]) {
      ctx.beginPath()
      ctx.arc(pt.x - d.dy * hw * sf, pt.y + d.dx * hw * sf, hw * 0.24, a + 0.44, a + Math.PI - 0.44)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  ctx.restore()

  // Body outline
  applyBodyPath(ctx, spine, edges)
  ctx.strokeStyle = 'rgba(60,90,80,0.55)'
  ctx.lineWidth = 1.3; ctx.stroke()
}

// ── Eyes — small, laterally placed, with sclera ring and specular ──────────
function drawEyes(ctx, spine) {
  const pt = spine[1], d = jDir(spine, 1)
  const off = pt.hw * 0.50
  for (const s of [-1, 1]) {
    const ex = pt.x - s * d.dy * off, ey = pt.y + s * d.dx * off
    ctx.save()
    ctx.beginPath(); ctx.arc(ex, ey, 6.2, 0, Math.PI * 2)
    ctx.fillStyle = '#C8C6B6'; ctx.fill()
    ctx.beginPath(); ctx.arc(ex, ey, 4.4, 0, Math.PI * 2)
    ctx.fillStyle = '#0E0C0C'; ctx.fill()
    ctx.beginPath(); ctx.arc(ex - 1.3, ey - 1.3, 1.7, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fill()
    ctx.restore()
  }
}

// ── Ripples ───────────────────────────────────────────────────────────────
function drawRipples(ctx, ripples) {
  ctx.save()
  ripples.forEach(r => {
    const alpha = (1 - r.age / r.maxAge) * 0.08
    ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(65,125,165,${alpha})`; ctx.lineWidth = 1.0; ctx.stroke()
  })
  ctx.restore()
}

// ═════════════════════════════════════════════════════════════════════════
export default function KoiFish({ mouseRef }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    let raf = null

    const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight }
    resize()
    window.addEventListener('resize', resize)

    const sx = innerWidth / 2, sy = innerHeight / 2, sa = -Math.PI / 2
    const state = {
      x: sx, y: sy, angle: sa, speed: 1.8,
      wanderHeading: sa - Math.PI * 0.5,
      wanderTimer: 0, wanderDue: 220,
      angVel: 0,
      wave: 0, dorsalPhase: 0, finFold: 0, time: 0,
      ripples: [], rippleTimer: 0, trail: [],
      joints: Array.from({ length: NJ }, (_, i) => ({
        x: sx + Math.cos(sa + Math.PI) * i * SEG,
        y: sy + Math.sin(sa + Math.PI) * i * SEG,
      })),
    }

    const tick = () => {
      const s = state
      const W = canvas.width, H = canvas.height
      const mouse = mouseRef.current

      s.time += 0.016

      const dM  = Math.hypot(mouse.x - s.x, mouse.y - s.y)
      const following = dM > 80 && dM < 840
      let diff

      // Calcular velocidade angular desejada
      let targetAngVel
      if (following) {
        diff = angleDiff(s.angle, Math.atan2(mouse.y - s.y, mouse.x - s.x))
        targetAngVel = clamp(diff, -0.026, 0.026)
      } else {
        s.wanderTimer++
        const bm = 150
        const nearEdge = s.x < bm || s.x > W - bm || s.y < bm || s.y > H - bm

        if (nearEdge) {
          s.wanderHeading = Math.atan2(H * 0.5 - s.y, W * 0.5 - s.x)
          s.wanderTimer   = 0
          s.wanderDue     = 300
          diff = angleDiff(s.angle, s.wanderHeading)
          targetAngVel = clamp(diff, -0.024, 0.024)
        } else {
          if (s.wanderTimer >= s.wanderDue) {
            const arc  = Math.PI * (0.33 + Math.random() * 1.17)
            const sign = Math.random() < 0.5 ? 1 : -1
            s.wanderHeading = s.angle + sign * arc
            s.wanderTimer   = 0
            s.wanderDue     = 220 + Math.round(Math.random() * 260)
          }
          diff = angleDiff(s.angle, s.wanderHeading)
          targetAngVel = clamp(diff, -0.010, 0.010)
        }
      }

      // Lerp da velocidade angular — elimina reversões bruscas na transição
      s.angVel  = lerp(s.angVel, targetAngVel, 0.12)
      s.angle  += s.angVel
      s.finFold = lerp(s.finFold, Math.abs(s.angVel) > 0.008 ? 1 : 0, 0.08)

      const beatBoost = (Math.sin(s.wave * 1.9) * 0.5 + 0.5) * 0.46
      s.speed = lerp(s.speed, 1.80 + beatBoost, 0.10)
      s.speed = clamp(s.speed, 1.2, 3.0)

      s.x = clamp(s.x + Math.cos(s.angle) * s.speed, 8, W - 8)
      s.y = clamp(s.y + Math.sin(s.angle) * s.speed, 8, H - 8)

      updateJoints(s.joints, s.x, s.y)
      // Wave speed scales with fish speed — faster fish = faster tail beat
      const waveStep = 0.058 + clamp(s.speed - 1.0, 0, 1.6) * 0.024
      s.wave        += waveStep
      s.dorsalPhase += waveStep * 0.68
      const spine = buildSpine(s.joints, s.wave)

      // Speed wake trail — record tail-area position
      const trailPt = spine[NJ - 3]
      if (trailPt) { s.trail.unshift({ x: trailPt.x, y: trailPt.y }); if (s.trail.length > 22) s.trail.pop() }

      // Ripples — frequency scales with speed
      const rippleEvery = Math.max(22, Math.round(52 / s.speed))
      if (++s.rippleTimer > rippleEvery) {
        s.rippleTimer = 0
        const mp = spine[Math.floor(NJ / 2)]
        if (mp) s.ripples.push({ x: mp.x, y: mp.y, radius: 5, age: 0, maxAge: 90 })
      }
      s.ripples = s.ripples
        .map(r => ({ ...r, radius: r.radius + 1.5, age: r.age + 1 }))
        .filter(r => r.age < r.maxAge)

      // Draw order: back → front
      drawWater(ctx, W, H, s.time)

      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.scale(0.52, 0.52)
      ctx.translate(-s.x, -s.y)
      drawWake(ctx, s.trail, s.speed)
      drawRipples(ctx, s.ripples)
      drawShadow(ctx, spine)
      drawCaudalAccents(ctx, spine, s.wave)
      drawCaudal(ctx, spine, s.wave)
      drawPelvics(ctx, spine, s.wave, s.finFold)
      drawPectorals(ctx, spine, s.wave, s.finFold)
      drawBodyAndPatches(ctx, spine)
      drawLateralLine(ctx, spine)
      drawDorsal(ctx, spine, s.dorsalPhase)
      ctx.restore()

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
}
