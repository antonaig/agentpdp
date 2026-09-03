import { useEffect, useState } from "react";

export function Gallery({ images, alt, preferred }: { images: string[]; alt: string; preferred?: string }) {
  const list = preferred && !images.includes(preferred) ? [preferred, ...images] : images;
  const [active, setActive] = useState(0);
  // A variant with its own image jumps the gallery to it (human click or agent select).
  useEffect(() => { if (preferred) { const i = list.indexOf(preferred); if (i >= 0) setActive(i); } }, [preferred]); // eslint-disable-line react-hooks/exhaustive-deps
  const main = list[Math.min(active, Math.max(0, list.length - 1))];
  return (
    <div className="gallery">
      <div className="gallery-main">
        {main ? <img src={main} alt={alt} loading="eager" /> : <span className="gallery-empty">No image on the source page</span>}
      </div>
      {list.length > 1 && (
        <div className="gallery-thumbs" role="tablist" aria-label="Product images">
          {list.slice(0, 8).map((src, i) => (
            <button key={src + i} type="button" role="tab" aria-selected={i === active} className={`gallery-thumb${i === active ? " active" : ""}`} onClick={() => setActive(i)}>
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
