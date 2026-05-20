export type WaveformInput = {
  peaks: number[];
  progress: number;
  hoverRatio?: number | null;
};

export function drawCanvas(canvas: HTMLCanvasElement | null, input: WaveformInput, staticCache?: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.width));
  const height = Math.max(1, Math.round(rect.height || canvas.height));
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (staticCache) context.drawImage(staticCache, 0, 0, width, height);
  else drawStaticWaveform(context, width, height, input.peaks);
  drawCursor(context, width, height, input);
}

export function createStaticWaveform(width: number, height: number, peaks: number[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  drawStaticWaveform(context, canvas.width, canvas.height, peaks);
  return canvas;
}

function drawStaticWaveform(context: CanvasRenderingContext2D, width: number, height: number, peaks: number[]): void {
  const center = height / 2;
  context.fillStyle = "#0b1118";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#385166";
  for (let x = 0; x < width; x += 2) {
    const peak = peaks[Math.floor((x / width) * peaks.length)] || 0.16;
    const barHeight = Math.max(2, peak * height * 0.82);
    context.fillRect(x, center - barHeight / 2, 1.4, barHeight);
  }
}

function drawCursor(context: CanvasRenderingContext2D, width: number, height: number, input: WaveformInput): void {
  const progressX = width * clamp(input.progress);
  context.fillStyle = "rgba(66, 216, 255, 0.24)";
  context.fillRect(0, 0, progressX, height);
  context.fillStyle = "#f8fbff";
  context.fillRect(progressX, 0, 2, height);
  if (input.hoverRatio !== null && input.hoverRatio !== undefined) {
    context.fillStyle = "rgba(255, 255, 255, 0.32)";
    context.fillRect(width * input.hoverRatio, 0, 1, height);
  }
}

export function clamp(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
