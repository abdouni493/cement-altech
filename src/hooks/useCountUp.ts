import { useEffect, useRef, useState } from 'react';

export function useCountUp(end: number, duration = 1000) {
  const [value, setValue] = useState(0);
  const frame = useRef<number>();
  const startTime = useRef<number>();

  useEffect(() => {
    startTime.current = undefined;
    const animate = (now: number) => {
      if (startTime.current === undefined) startTime.current = now;
      const progress = Math.min((now - startTime.current) / duration, 1);
      // easeOutExpo
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(end * eased);
      if (progress < 1) {
        frame.current = requestAnimationFrame(animate);
      } else {
        setValue(end);
      }
    };
    frame.current = requestAnimationFrame(animate);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [end, duration]);

  return value;
}
