import { useEffect, useState } from 'react';

// Rasterize noise once into a 128x128 dataURL tile. Renders as a static
// background-image on a fixed div — no SVG filter per-frame, no mix-blend-mode,
// so the GPU never has to re-composite the grain against scrolling content.
function generateGrainDataURL(size = 128, alpha = 22): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export function GrainOverlay() {
  const [url, setUrl] = useState('');

  useEffect(() => {
    setUrl(generateGrainDataURL());
  }, []);

  if (!url) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
        backgroundImage: `url(${url})`,
        backgroundRepeat: 'repeat',
        opacity: 0.5,
      }}
    />
  );
}
