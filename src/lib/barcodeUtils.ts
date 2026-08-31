import JsBarcode from 'jsbarcode';

// Generate a random EAN-13 barcode (12 digits + computed check digit)
export function generateEAN13(): string {
  let base = '';
  for (let i = 0; i < 12; i++) {
    base += Math.floor(Math.random() * 10).toString();
  }
  const check = computeEAN13CheckDigit(base);
  return base + check;
}

export function computeEAN13CheckDigit(base12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(base12[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check.toString();
}

// Render a barcode into an SVG/canvas element
export function renderBarcode(
  element: SVGSVGElement | HTMLCanvasElement,
  value: string,
  options?: JsBarcode.Options
) {
  try {
    JsBarcode(element, value, {
      format: 'EAN13',
      width: 2,
      height: 60,
      displayValue: true,
      fontSize: 14,
      margin: 8,
      background: '#ffffff',
      lineColor: '#2C1810',
      ...options,
    });
  } catch {
    // Fallback to CODE128 if value isn't a valid EAN13
    try {
      JsBarcode(element, value, {
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
        margin: 8,
        background: '#ffffff',
        lineColor: '#2C1810',
        ...options,
        format: 'CODE128',
      });
    } catch {
      /* ignore */
    }
  }
}

// Open a print window showing a large barcode + product name.
// The barcode is rendered locally with the bundled JsBarcode (no CDN — works offline),
// then injected as static SVG markup into the print window.
export function printBarcode(value: string, productName: string) {
  // Render into a detached SVG using the bundled library
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  renderBarcode(svg, value, { width: 3, height: 100, fontSize: 20, margin: 16 });
  const barcodeMarkup = new XMLSerializer().serializeToString(svg);

  const win = window.open('', '_blank', 'width=600,height=400');
  if (!win) return;
  win.document.write(`
    <html>
      <head>
        <title>Code-barres — ${productName}</title>
        <style>
          @page { size: A4; margin: 9mm; }
          body { font-family: 'Inter', Arial, sans-serif; text-align: center; padding: 32px; color: #000; font-weight: 700; }
          h2 { font-family: serif; color: #000; font-size: 28px; font-weight: 900; margin-bottom: 22px; text-transform: uppercase; }
          svg { margin: 0 auto; }
        </style>
      </head>
      <body>
        <h2>${productName}</h2>
        ${barcodeMarkup}
        <script>
          window.onload = function() { setTimeout(function(){ window.print(); }, 300); };
        </script>
      </body>
    </html>
  `);
  win.document.close();
}
