'use client';

import { cn } from '@/lib/cn';
import { Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PickedImage {
  /** A data: uri for the local preview, or '' when nothing is picked. */
  preview: string;
  /** Bytes of the compressed preview. */
  bytes: number;
  name: string;
  originalBytes: number;
}

const EMPTY: PickedImage = { preview: '', bytes: 0, name: '', originalBytes: 0 };

/**
 * Pick an image from the photo library / file system.
 *
 * The file is cover-cropped to a square and re-encoded on a canvas, so a 4 MB
 * phone photo becomes a small preview. It is a *local preview only*: the image
 * has to be uploaded to permanent storage (Arweave / IPFS) and the resulting
 * link is what gets stored on-chain.
 */
export function ImagePicker({ onChange }: { onChange: (image: PickedImage) => void }) {
  const [image, setImage] = useState<PickedImage>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange(image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Images above 8 MB are rejected.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const preview = await compress(file, 256);
      setImage({
        preview,
        bytes: preview.length,
        name: file.name,
        originalBytes: file.size,
      });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not read that image.');
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setError(null);
    setImage(EMPTY);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Choose an image"
          className={cn(
            'flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed bg-black/60 transition-colors',
            image.preview ? 'border-white/15' : 'border-slate-700 hover:border-slate-500',
          )}
        >
          {busy ? (
            <Loader2 size={18} className="animate-spin text-slate-500" />
          ) : image.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.preview} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon size={18} className="text-slate-600" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-ghost"
              disabled={busy}
            >
              <Upload size={12} /> Choose from library
            </button>
            {image.preview ? (
              <button type="button" onClick={clear} className="btn-quiet" disabled={busy}>
                <Trash2 size={12} /> Remove
              </button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <p className="text-[10px] font-extralight leading-relaxed text-slate-600">
            {image.name
              ? `${image.name}  ${(image.originalBytes / 1024).toFixed(0)} KB  preview only`
              : 'PNG, JPG, WebP or GIF. This is a local preview - upload the file to permanent storage and paste the link below.'}
          </p>
          {error ? <p className="text-[10px] font-extralight text-[#ffa2ae]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** Cover-crop to a square and re-encode, so a phone photo becomes a small preview. */
async function compress(file: File, size: number): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  const scale = Math.max(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL('image/webp', 0.72);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be decoded.'));
    image.src = src;
  });
}
