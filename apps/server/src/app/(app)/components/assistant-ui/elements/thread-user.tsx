'use client'

import { UserMessageAttachments } from '@/components/assistant-ui/elements/attachment.aui'
import { File, getFileHref } from '@/components/assistant-ui/elements/file'
import { Image as MessageImage } from '@/components/assistant-ui/elements/image'
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
} from '@assistant-ui/react'
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon } from 'lucide-react'
import { type FC } from 'react'

export const MessageFile: FileMessagePartComponent = (part) => {
  const image =
    typeof part.mimeType === 'string' &&
    typeof part.data === 'string' &&
    part.mimeType.toLowerCase().startsWith('image/')
      ? getFileHref(part.data, part.mimeType, part.sourceType)
      : null
  if (!image) return <File {...part} />
  return (
    <MessageImage
      type="image"
      image={image}
      status={part.status}
      {...(typeof part.filename === 'string' && { filename: part.filename })}
    />
  )
}
export const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="py-1">
    <MessageFile {...part} />
  </div>
)
export const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="py-1">
    <MessageImage {...part} />
  </div>
)
export const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className={cn(
        'fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto',
        'grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150',
        '[contain-intrinsic-size:auto_200px] [content-visibility:auto]',
        '[&:where(>*)]:col-start-2',
      )}
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div
          className={cn(
            'aui-user-message-content peer bg-muted text-foreground',
            'rounded-(--composer-radius) px-4 py-2 wrap-break-word empty:hidden',
          )}
        >
          <MessagePrimitive.Parts components={{ File: UserFilePart, Image: UserImagePart }} />
        </div>
        <div
          className={cn(
            'aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full',
            '-translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full',
          )}
        >
          <UserActionBar />
        </div>
      </div>

      <BranchPicker data-slot="aui_user-branch-picker" className="col-span-full col-start-1 -me-1 justify-end" />
    </MessagePrimitive.Root>
  )
}
export const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  )
}
export const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root
        className={cn(
          'aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25',
          'ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius)',
          'border bg-(--composer-bg) transition-[border-color]',
        )}
      >
        <ComposerPrimitive.Input
          className={cn(
            'aui-edit-composer-input text-foreground min-h-14 w-full resize-none',
            'bg-transparent px-4 pt-3 pb-1 text-base outline-none',
          )}
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 px-3">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 px-3">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  )
}
export const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        'aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs',
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  )
}
