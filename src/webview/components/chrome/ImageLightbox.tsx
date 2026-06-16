import type { ReactNode } from 'react';

interface ImageLightboxProps {
  src: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, onClose }: ImageLightboxProps): ReactNode {
  return (
    <div
      className="image-lightbox"
      id="image-lightbox"
      style={{ display: src ? '' : 'none' }}
      onClick={onClose}
    >
      <img className="image-lightbox-img" id="image-lightbox-img" alt="" src={src} />
    </div>
  );
}
