import { useEffect, useRef } from "react";

type PageCurlViewToggleProps = {
  label: string;
  ariaLabel: string;
  className?: string;
  redrawKey?: string;
  onClick: () => void;
};

type CurlConfig = {
  currentFace: string;
  targetFace: string;
  targetText: string;
  shadow: string;
  curlShadow: string;
  edgeHiA: string;
  edgeHiB: string;
};

const WIDTH = 150;
const HEIGHT = 118;
const TOP_CURL = 112;
const LEFT_CURL = 104;
const ANIMATION_MS = 260;

export function PageCurlViewToggle({ label, ariaLabel, className = "", redrawKey = "", onClick }: PageCurlViewToggleProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(0);
  const targetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const animationRef = useRef<{ from: number; to: number; startedAt: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${HEIGHT}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const draw = (progress: number) => {
      drawTopLeftCurl(ctx, progress, readCurlConfig(canvas), label);
    };

    const tick = (now: number) => {
      const animation = animationRef.current;
      if (!animation) {
        rafRef.current = null;
        return;
      }

      const elapsed = Math.max(0, now - animation.startedAt);
      const progress = Math.min(elapsed / ANIMATION_MS, 1);
      const eased = easeInOutCubic(progress);
      progressRef.current = animation.from + (animation.to - animation.from) * eased;
      draw(progressRef.current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      progressRef.current = animation.to;
      targetRef.current = animation.to;
      animationRef.current = null;
      draw(animation.to);
      rafRef.current = null;
    };

    const animateTo = (target: number) => {
      if (targetRef.current === target && rafRef.current !== null) return;
      targetRef.current = target;
      animationRef.current = {
        from: progressRef.current,
        to: target,
        startedAt: performance.now(),
      };
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    draw(progressRef.current);

    const canvasElement = canvas;
    const enter = () => {
      animateTo(1);
    };
    const leave = () => {
      animateTo(0);
    };

    canvasElement.parentElement?.addEventListener("mouseenter", enter);
    canvasElement.parentElement?.addEventListener("mouseleave", leave);

    return () => {
      canvasElement.parentElement?.removeEventListener("mouseenter", enter);
      canvasElement.parentElement?.removeEventListener("mouseleave", leave);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [redrawKey]);

  return (
    <button className={`page-curl-view-toggle ${className}`.trim()} type="button" aria-label={ariaLabel} onClick={onClick}>
      <canvas ref={canvasRef} className="page-curl-view-toggle__canvas" aria-hidden="true" />
      <span className="page-curl-view-toggle__label">{label}</span>
    </button>
  );
}

function drawTopLeftCurl(ctx: CanvasRenderingContext2D, progress: number, config: CurlConfig, label: string) {
  const p = Math.max(0, Math.min(1, progress));
  const w = WIDTH;
  const h = HEIGHT;
  const curlX = TOP_CURL * p;
  const curlY = LEFT_CURL * p;
  const controlA = { x: 18 * p, y: curlY - 10 * p };
  const controlB = { x: curlX - 44 * p, y: 12 * p };

  ctx.clearRect(0, 0, w, h);
  if (curlX < 0.5 || curlY < 0.5) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(curlX, 0);
  ctx.bezierCurveTo(controlB.x, controlB.y, controlA.x, controlA.y, 0, curlY);
  ctx.closePath();
  ctx.fillStyle = config.targetFace;
  ctx.fill();

  ctx.clip();
  const foldLight = ctx.createLinearGradient(0, 0, curlX, curlY * 0.9);
  foldLight.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  foldLight.addColorStop(0.48, "rgba(255, 255, 255, 0.02)");
  foldLight.addColorStop(0.76, "rgba(255, 255, 255, 0.06)");
  foldLight.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = foldLight;
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = Math.min(1, p * 1.25);
  ctx.fillStyle = config.targetText;
  ctx.font = "700 15px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 8, 27);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, curlY);
  ctx.bezierCurveTo(controlA.x, controlA.y, controlB.x, controlB.y, curlX, 0);
  const edge = ctx.createLinearGradient(0, curlY, curlX, 0);
  edge.addColorStop(0, config.edgeHiA);
  edge.addColorStop(0.5, config.edgeHiB);
  edge.addColorStop(1, config.edgeHiA);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function readCurlConfig(canvas: HTMLCanvasElement): CurlConfig {
  const style = getComputedStyle(canvas.parentElement ?? canvas);
  const read = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    currentFace: read("--page-curl-current-bg", "#111318"),
    targetFace: read("--page-curl-target-bg", "#0e0f12"),
    targetText: read("--page-curl-target-text", "rgba(238,242,246,0.72)"),
    shadow: read("--page-curl-shadow", "rgba(0,0,0,0.2)"),
    curlShadow: read("--page-curl-curl-shadow", "rgba(0,0,0,0.24)"),
    edgeHiA: read("--page-curl-edge-a", "rgba(255,255,255,0.04)"),
    edgeHiB: read("--page-curl-edge-b", "rgba(255,255,255,0.14)"),
  };
}

