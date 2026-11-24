"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ImageOffIcon,
} from "lucide-react";
import { useCallback, type RefObject } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { safeHref } from "../utils/href";
import { ghostButton, mono } from "./surfaces";
import type { GalleryImage } from "./image-gallery";

const navButton =
  "size-8 shrink-0 disabled:pointer-events-none disabled:opacity-30";

export type GalleryNav = {
  previousRef: RefObject<HTMLButtonElement | null>;
  nextRef: RefObject<HTMLButtonElement | null>;
  close: () => void;
  show: (index: number) => void;
};

function SourceLink({ source }: { source: NonNullable<GalleryImage["source"]> }) {
  const href = safeHref(source.url);
  if (!source.label) return null;
  if (!href) {
    return (
      <span className="text-muted-foreground truncate">{source.label}</span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-muted-foreground hover:text-foreground/80 flex min-w-0",
        "items-center gap-1 truncate transition-colors",
      )}
    >
      <span className="truncate">{source.label}</span>
      <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function DialogStage({
  image,
  failed,
  onError,
}: {
  image: GalleryImage;
  failed: boolean;
  onError: () => void;
}) {
  const focusDialog = useCallback((node: HTMLDivElement | null) => {
    node?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, []);

  return (
    <div
      ref={focusDialog}
      className="flex min-h-0 items-center justify-center px-10"
    >
      {failed ? (
        <div
          className={cn(
            "text-muted-foreground flex h-[min(75vh,32rem)] w-full",
            "items-center justify-center",
          )}
        >
          <ImageOffIcon aria-hidden className="size-8" />
        </div>
      ) : (
        <img
          src={image.src}
          alt={image.alt}
          className="max-h-[75vh] max-w-full object-contain"
          onError={onError}
        />
      )}
    </div>
  );
}

function DialogControls({
  image,
  index,
  total,
  nav,
}: {
  image: GalleryImage;
  index: number;
  total: number;
  nav: GalleryNav;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        ref={nav.previousRef}
        type="button"
        aria-label="Previous image"
        disabled={index === 0}
        onClick={() => nav.show(index - 1)}
        className={cn(ghostButton, navButton)}
      >
        <ChevronLeftIcon aria-hidden className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {image.caption ? (
          <p className="text-foreground/75 truncate">{image.caption}</p>
        ) : null}
        {image.source ? <SourceLink source={image.source} /> : null}
      </div>
      <span className={cn(mono, "text-muted-foreground shrink-0")}>
        {index + 1} / {total}
      </span>
      <button
        ref={nav.nextRef}
        type="button"
        aria-label="Next image"
        disabled={index === total - 1}
        onClick={() => nav.show(index + 1)}
        className={cn(ghostButton, navButton)}
      >
        <ChevronRightIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function GalleryDialog({
  images,
  image,
  index,
  failed,
  nav,
  onError,
}: {
  images: readonly GalleryImage[];
  image: GalleryImage;
  index: number;
  failed: boolean;
  nav: GalleryNav;
  onError: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) nav.close();
      }}
    >
      <DialogContent
        className={cn(
          "gap-3 p-3 duration-150 motion-reduce:animate-none",
          "sm:max-w-[min(56rem,calc(100%-2rem))]",
        )}
      >
        <DialogTitle className="sr-only">
          Image {index + 1} of {images.length}
        </DialogTitle>
        <DialogStage image={image} failed={failed} onError={onError} />
        <DialogControls
          image={image}
          index={index}
          total={images.length}
          nav={nav}
        />
      </DialogContent>
    </Dialog>
  );
}
