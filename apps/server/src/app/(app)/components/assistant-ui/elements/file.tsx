'use client'

import { memo, type ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { FileIcon, DownloadIcon } from 'lucide-react'
import type { FileMessagePartComponent } from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { AudioPlayer, VideoPlayer } from './media-player'
import {
  formatFileSize,
  getBase64Size,
  getDataUrlSize,
  getFileDataKind,
  getFileHref,
  getFileLabel,
  getMimeTypeIcon,
} from './file-utils'
export type { FileDataKind } from './file-utils'
const fileVariants = cva('aui-file-root inline-flex items-center gap-3 rounded-lg transition-colors', {
  variants: {
    variant: {
      outline: 'border-border hover:bg-muted/50 border',
      ghost: 'hover:bg-muted/50',
      muted: 'bg-muted/50 hover:bg-muted/70',
    },
    size: {
      sm: 'px-2.5 py-1.5 text-xs',
      default: 'px-3 py-2 text-sm',
      lg: 'px-4 py-3 text-base',
    },
  },
  defaultVariants: {
    variant: 'outline',
    size: 'default',
  },
})
export type FileRootProps = React.ComponentProps<'div'> & VariantProps<typeof fileVariants>
function FileRoot({ className, variant, size, children, ...props }: FileRootProps) {
  return (
    <div
      data-slot="file-root"
      data-variant={variant}
      data-size={size}
      className={cn(fileVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  )
}
type FileIconDisplayProps = React.ComponentProps<'span'> & {
  mimeType?: string
}
function FileIconDisplay({ mimeType, className, children, ...props }: FileIconDisplayProps) {
  const IconComponent = mimeType ? getMimeTypeIcon(mimeType) : FileIcon
  return (
    <span data-slot="file-icon" className={cn('text-muted-foreground shrink-0', className)} {...props}>
      {children ?? <IconComponent className="size-5" />}
    </span>
  )
}
function FileName({ className, children, ...props }: React.ComponentProps<'span'>) {
  return (
    <span data-slot="file-name" className={cn('min-w-0 flex-1 truncate font-medium', className)} {...props}>
      {children || 'Unnamed file'}
    </span>
  )
}
type FileSizeProps = React.ComponentProps<'span'> & {
  bytes: number
}
function FileSize({ bytes, className, ...props }: FileSizeProps) {
  return (
    <span data-slot="file-size" className={cn('text-muted-foreground shrink-0', className)} {...props}>
      {formatFileSize(bytes)}
    </span>
  )
}
type FileDownloadProps = Omit<React.ComponentProps<'a'>, 'href'> & {
  data: string
  mimeType: string
  filename?: string
  sourceType?: 'url' | 'id'
}
function FileDownload({ data, mimeType, filename, sourceType, className, children, ...props }: FileDownloadProps) {
  if (typeof data !== 'string') return null
  const kind = getFileDataKind(data, sourceType)
  const href = getFileHref(data, mimeType, sourceType)
  if (!href) return null
  return (
    <a
      data-slot="file-download"
      href={href}
      download={filename || 'download'}
      {...(kind === 'url' && { target: '_blank', rel: 'noopener noreferrer' })}
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded-md p-1 transition-colors',
        className,
      )}
      aria-label={!children ? `Download ${filename || 'file'}` : undefined}
      {...props}
    >
      {children || <DownloadIcon className="size-4" />}
    </a>
  )
}
export interface FilePlayerProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  data: string
  mimeType: string
  filename?: string | undefined
  sourceType?: 'url' | 'id' | undefined
}
function FilePlayer({ data, mimeType, filename, sourceType, className, ...props }: FilePlayerProps) {
  const src = getFileHref(data, mimeType, sourceType)
  const normalizedMimeType = mimeType.toLowerCase()
  if (!src || (!normalizedMimeType.startsWith('audio/') && !normalizedMimeType.startsWith('video/'))) {
    return null
  }
  return (
    <div data-slot="file-player" className={cn('w-full', className)} {...props}>
      {normalizedMimeType.startsWith('audio/') ? (
        <AudioPlayer src={src} title={filename} />
      ) : (
        <VideoPlayer src={src} title={filename} />
      )}
    </div>
  )
}
type FileSourceType = 'url' | 'id' | undefined
interface FileFields {
  data: string | undefined
  mimeType: string
  filename: string | undefined
  sourceType: FileSourceType
}
const readFileFields = (part: ComponentProps<FileMessagePartComponent>): FileFields => ({
  data: typeof part.data === 'string' ? part.data : undefined,
  mimeType: typeof part.mimeType === 'string' ? part.mimeType : 'application/octet-stream',
  filename: typeof part.filename === 'string' ? part.filename : undefined,
  sourceType: part.sourceType === 'url' || part.sourceType === 'id' ? part.sourceType : undefined,
})
const optionalFileProps = ({ filename, sourceType }: Pick<FileFields, 'filename' | 'sourceType'>) => ({
  ...(filename !== undefined && { filename }),
  ...(sourceType !== undefined && { sourceType }),
})
const fileBytes = (data: string | undefined, sourceType: FileSourceType) => {
  if (data === undefined) return undefined
  const kind = getFileDataKind(data, sourceType)
  if (kind === 'data-uri') return getDataUrlSize(data)
  return kind === 'base64' ? getBase64Size(data) : undefined
}
const isMediaType = (mimeType: string) => /^(audio|video)\//i.test(mimeType)
function MediaFile({ data, mimeType, filename, sourceType, bytes }: FileFields & { data: string; bytes?: number }) {
  const extra = optionalFileProps({ filename, sourceType })
  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <FilePlayer data={data} mimeType={mimeType} {...extra} />
      <div className="flex min-w-0 items-center justify-end gap-2 px-1">
        {bytes !== undefined && <FileSize bytes={bytes} className="text-muted-foreground text-[11px]" />}
        <FileDownload data={data} mimeType={mimeType} {...extra} />
      </div>
    </div>
  )
}
function PlainFile({ data, mimeType, filename, sourceType, bytes }: FileFields & { bytes?: number }) {
  return (
    <FileRoot>
      <FileIconDisplay mimeType={mimeType} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FileName>{filename || getFileLabel(mimeType)}</FileName>
        {bytes !== undefined && <FileSize bytes={bytes} className="text-xs" />}
      </div>
      {data !== undefined && (
        <FileDownload data={data} mimeType={mimeType} {...optionalFileProps({ filename, sourceType })} />
      )}
    </FileRoot>
  )
}
const FileImpl: FileMessagePartComponent = (part) => {
  const fields = readFileFields(part)
  const { data, mimeType, sourceType } = fields
  const bytes = fileBytes(data, sourceType)
  const mediaSource = data === undefined ? null : getFileHref(data, mimeType, sourceType)
  if (data !== undefined && mediaSource && isMediaType(mimeType)) {
    return <MediaFile {...fields} data={data} {...(bytes !== undefined && { bytes })} />
  }
  return <PlainFile {...fields} {...(bytes !== undefined && { bytes })} />
}
const File = Object.assign(memo(FileImpl), {
  displayName: 'File',
  Root: FileRoot,
  Icon: FileIconDisplay,
  Name: FileName,
  Size: FileSize,
  Download: FileDownload,
  Player: FilePlayer,
})
export {
  File,
  FileRoot,
  FileIconDisplay,
  FileName,
  FileSize,
  FileDownload,
  FilePlayer,
  fileVariants,
  getMimeTypeIcon,
  getFileDataKind,
  getFileHref,
  getBase64Size,
  formatFileSize,
}
