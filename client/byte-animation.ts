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

/** Animate only between two real readings of the same request. Never carry a count through a
 * session/request change, unavailable telemetry or failure, and never overshoot a received value. */
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
        const progress = Math.min(1, Math.max(0, (time.now() - began) / 180));
        displayed = Math.min(bytes, Math.round(start + (bytes - start) * (1 - (1 - progress) ** 3)));
        paint(displayed);
        if (progress < 1) stop = time.schedule(frame);
        else stop = undefined;
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
