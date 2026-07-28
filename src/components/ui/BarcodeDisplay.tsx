import { useEffect, useRef } from 'react';
import { renderBarcode } from '@/lib/barcodeUtils';

interface BarcodeDisplayProps {
  value: string;
  height?: number;
  width?: number;
  displayValue?: boolean;
  className?: string;
}

export function BarcodeDisplay({
  value,
  height = 50,
  width = 1.6,
  displayValue = true,
  className,
}: BarcodeDisplayProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (ref.current && value) {
      renderBarcode(ref.current, value, { height, width, displayValue });
    }
  }, [value, height, width, displayValue]);

  if (!value) return null;
  return <svg ref={ref} className={className} />;
}
