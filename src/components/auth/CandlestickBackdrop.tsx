"use client";

import { motion } from "framer-motion";
import { useDashboardData } from "@/lib/data-context";
import { computeQoQChanges } from "@/lib/analytics";

const WIDTH = 1000;
const HEIGHT = 200;
const PAD_Y = 24;

export function CandlestickBackdrop() {
  const { banks } = useDashboardData();
  const home = banks.find((b) => b.isHomeInstitution) ?? banks[0];
  if (!home) return null;

  const changes = computeQoQChanges(home, "roe");
  if (changes.length < 3) return null;

  const allEndpoints = changes.flatMap((c) => [c.value, c.previousValue]);
  const min = Math.min(...allEndpoints);
  const max = Math.max(...allEndpoints);
  const range = max - min || 1;

  const scaleY = (v: number) => PAD_Y + (1 - (v - min) / range) * (HEIGHT - PAD_Y * 2);

  const slotWidth = WIDTH / changes.length;
  const bodyWidth = slotWidth * 0.42;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22%] overflow-hidden opacity-[0.3]">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full" preserveAspectRatio="none">
        {changes.map((c, i) => {
          const cx = slotWidth * i + slotWidth / 2;
          const openY = scaleY(c.previousValue);
          const closeY = scaleY(c.value);
          const up = c.value >= c.previousValue;
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
          const wickPad = Math.max(bodyHeight * 0.6, 10);

          return (
            <motion.g
              key={c.period}
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{ duration: 0.5, delay: 0.4 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: `${cx}px ${HEIGHT}px` }}
            >
              <line
                x1={cx}
                x2={cx}
                y1={bodyTop - wickPad}
                y2={bodyTop + bodyHeight + wickPad}
                stroke={up ? "#2dd4bf" : "#fb7185"}
                strokeWidth={1.5}
              />
              <rect
                x={cx - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={bodyHeight}
                fill={up ? "#2dd4bf" : "#fb7185"}
                rx={1.5}
              />
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
