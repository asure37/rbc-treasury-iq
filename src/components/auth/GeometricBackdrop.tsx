"use client";

import { motion } from "framer-motion";

const CENTER = 400;
const RING_RADII = [90, 160, 230, 300];
const RING_ROTATION_SPEED = [26, -34, 42, -50]; // seconds per revolution, alternating direction

function hexPoints(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 90);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  });
}

function polygonPath(points: readonly (readonly [number, number])[]) {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
}

export function GeometricBackdrop() {
  const outerVertices = hexPoints(CENTER, CENTER, RING_RADII[RING_RADII.length - 1]);
  const innerVertices = hexPoints(CENTER, CENTER, RING_RADII[0]);

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.4]">
      <svg viewBox="0 0 800 800" className="h-[130%] w-[130%] max-w-none">
        <defs>
          <radialGradient id="geo-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00b6f1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#00b6f1" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* soft pulsing core glow */}
        <motion.circle
          cx={CENTER}
          cy={CENTER}
          r={140}
          fill="url(#geo-glow)"
          animate={{ opacity: [0.4, 0.75, 0.4], scale: [1, 1.08, 1] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
        />

        {/* symmetric radial spokes to the innermost hexagon */}
        {innerVertices.map(([x, y], i) => (
          <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="#5ce1ff" strokeWidth={1} strokeOpacity={0.35} />
        ))}

        {/* concentric rotating hexagon rings */}
        {RING_RADII.map((r, i) => (
          <motion.path
            key={r}
            d={polygonPath(hexPoints(CENTER, CENTER, r))}
            fill="none"
            stroke={i % 2 === 0 ? "#00b6f1" : "#0051a5"}
            strokeWidth={i === RING_RADII.length - 1 ? 2 : 1.2}
            strokeOpacity={0.55 - i * 0.08}
            initial={{ rotate: 0 }}
            animate={{ rotate: 360 }}
            transition={{ duration: Math.abs(RING_RADII.length ? RING_ROTATION_SPEED[i] : 30), repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
          />
        ))}

        {/* twinkling nodes at the outer hexagon's vertices */}
        {outerVertices.map(([x, y], i) => (
          <motion.circle
            key={i}
            cx={x}
            cy={y}
            r={4}
            fill="#5ce1ff"
            initial={{ opacity: 0.2 }}
            animate={{ opacity: [0.2, 1, 0.2], scale: [1, 1.6, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
            style={{ transformOrigin: `${x}px ${y}px` }}
          />
        ))}
      </svg>
    </div>
  );
}
