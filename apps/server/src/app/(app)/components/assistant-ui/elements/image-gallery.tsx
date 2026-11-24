"use client";

import { ImageOffIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { cn } from "@/lib/utils";
import { clamp } from "../utils/range";
import { field } from "./surfaces";
import { GalleryDialog } from "./image-gallery-dialog";

export interface GalleryImage {
  id: string;
  src: string;
  alt: string;
  caption?: string | undefined;
  source?: { label?: string | undefined; url?: string | undefined } | undefined;
}

export interface ImageGalleryProps extends Omit<
  ComponentProps<"div">,
  "children"
> {
  images: readonly GalleryImage[];
  maxVisible?: number | undefined;
  onOpen?: ((id: string) => void) | undefined;
}

const keyForImage = (image: GalleryImage) => `${image.id}\u0000${image.src}`;

function useGalleryNav(
  images: readonly GalleryImage[],
  onOpen: ((id: string) => void) | undefined,
) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const previousRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const index = images.findIndex((image) => image.id === activeId);
  if (activeId !== null && index === -1) setActiveId(null);
  const activeImage = index === -1 ? undefined : images[index];

  const close = useCallback(() => {
    setActiveId(null);
    triggerRef.current?.focus();
  }, []);

  const show = useCallback(
    (nextIndex: number) => {
      const image = images[nextIndex];
      if (!image) return;
      const focused = document.activeElement;
      if (nextIndex === 0 && focused === previousRef.current) {
        nextRef.current?.focus();
      } else if (
        nextIndex === images.length - 1 &&
        focused === nextRef.current
      ) {
        previousRef.current?.focus();
      }
      setActiveId(image.id);
    },
    [images],
  );

  useEffect(() => {
    if (activeImage === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        show(index - 1);
      } else if (event.key === "ArrowRight" && index < images.length - 1) {
        event.preventDefault();
        show(index + 1);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeImage, images.length, index, show]);

  const open = (nextIndex: number, trigger: HTMLButtonElement) => {
    const image = images[nextIndex];
    if (!image) return;
    triggerRef.current = trigger;
    setActiveId(image.id);
    onOpen?.(image.id);
  };

  return { index, activeImage, previousRef, nextRef, close, show, open };
}

function GalleryThumb({
  image,
  failed,
  overflowCount,
  onOpen,
  onError,
}: {
  image: GalleryImage;
  failed: boolean;
  overflowCount: number;
  onOpen: (trigger: HTMLButtonElement) => void;
  onError: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Open image: ${image.alt}`}
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(
        field,
        "focus-visible:ring-foreground/30 relative aspect-square",
        "overflow-hidden rounded-xl duration-150 outline-none",
        "transition-[transform,background-color] hover:scale-[1.01]",
        "focus-visible:ring-1 active:scale-[0.98] motion-reduce:transition-none",
      )}
    >
      {failed ? (
        <span
          className={cn(
            "text-muted-foreground flex size-full items-center justify-center",
          )}
        >
          <ImageOffIcon aria-hidden className="size-6" />
        </span>
      ) : (
        <img
          src={image.src}
          alt={image.alt}
          loading="lazy"
          className="size-full object-cover"
          onError={onError}
        />
      )}
      {overflowCount > 0 ? (
        <span
          className={cn(
            "bg-foreground/65 text-background absolute inset-0 flex",
            "items-center justify-center text-lg font-medium",
          )}
        >
          +{overflowCount}
        </span>
      ) : null}
    </button>
  );
}

export function ImageGallery({
  images,
  maxVisible = 6,
  onOpen,
  className,
  ...props
}: ImageGalleryProps) {
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const nav = useGalleryNav(images, onOpen);
  const visibleCount = Math.floor(clamp(maxVisible, 1, images.length));

  const markFailed = (image: GalleryImage) => {
    const key = keyForImage(image);
    setFailedImages((current) =>
      current.has(key) ? current : new Set(current).add(key),
    );
  };

  if (images.length === 0) return null;

  return (
    <div
      data-slot="image-gallery"
      className={cn("@container w-full max-w-md", className)}
      {...props}
    >
      <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3">
        {images.slice(0, visibleCount).map((image, imageIndex) => (
          <GalleryThumb
            key={image.id}
            image={image}
            failed={failedImages.has(keyForImage(image))}
            overflowCount={
              imageIndex === visibleCount - 1
                ? Math.max(0, images.length - visibleCount)
                : 0
            }
            onOpen={(trigger) => nav.open(imageIndex, trigger)}
            onError={() => markFailed(image)}
          />
        ))}
      </div>
      {nav.activeImage ? (
        <GalleryDialog
          images={images}
          image={nav.activeImage}
          index={nav.index}
          failed={failedImages.has(keyForImage(nav.activeImage))}
          nav={nav}
          onError={() => markFailed(nav.activeImage as GalleryImage)}
        />
      ) : null}
    </div>
  );
}
