interface Clock {
  now(): number;
  schedule(callback: () => void): () => void;
}

const clock: Clock = {
  now: () => Date.now(),
  schedule: (callback) => {
    const timer = setTimeout(callback, 16);
    return () => clearTimeout(timer);
  },
};

const ANIMATION_MS = 320;

/** A restrained spring: it reaches the new reading quickly, gives a small jelly-like settle,
 * then lands on the exact value. The clamp keeps the displayed count from exceeding telemetry. */
function springProgress(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  const value = 1 - Math.exp(-5.5 * t) * Math.cos(10.5 * t);
  return Math.min(1, Math.max(0, value));
}

/** Animate only between two real readings of the same request. Never carry a count through a
 * session/request change, unavailable telemetry or failure, and always finish at the real value. */
export function createByteAnimation(paint: (value: number | undefined) => void, time: Clock = clock) {
  let request: string | undefined;
  let displayed: number | undefined;
  let stop: (() => void) | undefined;
  let generation = 0;
  let disposed = false;
  return {
    update(key: string | undefined, bytes: number | undefined, animate: boolean) {
      if (disposed) return;
      stop?.();
      stop = undefined;
      const current = ++generation;
      const start = displayed;
      const sameRequest = key !== undefined && key === request;
      request = key;
      if (!sameRequest || !animate || bytes === undefined || start === undefined || bytes <= start) {
        displayed = bytes;
        paint(bytes);
        return;
      }
      const began = time.now();
      const frame = () => {
        if (disposed || current !== generation) return;
        const progress = Math.min(1, Math.max(0, (time.now() - began) / ANIMATION_MS));
        displayed = Math.min(bytes, Math.round(start + (bytes - start) * springProgress(progress)));
        paint(displayed);
        if (progress < 1) stop = time.schedule(frame);
        else {
          displayed = bytes;
          paint(bytes);
          stop = undefined;
        }
      };
      frame();
    },
    dispose() {
      disposed = true;
      generation++;
      stop?.();
    },
  };
}
