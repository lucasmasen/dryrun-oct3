"use client";

import BorderBeam from "border-beam";
import { Liquid } from "liquid-gooey";
import { useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { BoardPhase } from "@/lib/frontend/delegate/model";


function useMotionGate(ref: RefObject<HTMLDivElement | null>, manuallyPaused = false) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [pageVisible, setPageVisible] = useState(false);
  const [inViewport, setInViewport] = useState(true);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updateMotion();
    updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);

    const host = ref.current;
    const observer = host && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => setInViewport(entry.isIntersecting))
      : null;
    if (host) observer?.observe(host);

    return () => {
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer?.disconnect();
    };
  }, [ref]);

  return manuallyPaused || reducedMotion || !pageVisible || !inViewport;
}

const ORB_STATE: Record<BoardPhase, OrbState> = {
  connecting: "connecting",
  listening: "listening",
  weaving: "weaving",
  breathing: "breathing",
  closed: "breathing",
};

export function AgentOrb({ phase, paused = false }: { phase: BoardPhase; paused?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const motionPaused = useMotionGate(hostRef, paused || phase === "closed");
  return (
    <div ref={hostRef} style={{ display: "block", width: 128, height: 128 }}>
      <ThinkingOrb
        state={ORB_STATE[phase]}
        size={64}
        theme="dark"
        paused={motionPaused}
        aria-label={phase === "closed" ? "Task closed" : undefined}
        style={{ display: "block", width: 128, height: 128 }}
      />
    </div>
  );
}

export function ArrivalBeam({ active, children }: { active: boolean; children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const motionPaused = useMotionGate(hostRef);

  return (
    <BorderBeam
      ref={hostRef}
      size="line"
      colorVariant="mono"
      staticColors
      theme="dark"
      duration={1.96}
      strength={0.55}
      active={active && !motionPaused}
    >
      {children}
    </BorderBeam>
  );
}


const MERGE_LAYOUTS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[0, -18]],
  [[-40, 18], [40, 18]],
  [[-40, 18], [0, -18], [40, 18]],
  [[-80, 0], [-40, 18], [40, 18], [80, 0]],
  [[-80, 0], [-40, 18], [0, -18], [40, 18], [80, 0]],
];

export function SignalMerge({
  count,
  closing,
  paused = false,
}: {
  count: number;
  closing: boolean;
  paused?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const motionPaused = useMotionGate(hostRef, paused);
  const dotCount = Math.min(5, Math.max(0, Math.floor(count)));
  const layout = MERGE_LAYOUTS[dotCount] ?? [];

  const transition = closing && !motionPaused
    ? { duration: 240, ease: "cubic-bezier(0.23, 1, 0.32, 1)" }
    : { duration: 0, ease: "linear" };

  return (
    <Liquid
      ref={hostRef}
      fill="#f5f2eb"
      blur={6}
      contrast={18}
      aria-hidden="true"
      style={{
        width: dotCount ? 224 : 0,
        height: dotCount ? 96 : 0,
        display: dotCount ? "block" : "none",
        position: "relative",
        overflow: "visible",
      }}
    >
      {layout.map(([x, y], index) => (
        <Liquid.Item
          key={index}
          x={closing ? 0 : x}
          y={closing ? 0 : y}
          transition={transition}
          morph={{ shape: true, contentBlur: 0, bounce: 0.2 }}
          style={{ position: "absolute", left: "calc(50% - 6px)", top: "calc(50% - 6px)" }}
        >
          <span style={{ display: "block", width: 12, height: 12, borderRadius: "50%", background: "transparent" }} />
        </Liquid.Item>
      ))}
    </Liquid>
  );
}

export function SilverFrame({ children }: { children: ReactElement; paused?: boolean }) {
  return <div style={{ display: "inline-flex", border: "1px solid #d2d2d2" }}>{children}</div>;
}
