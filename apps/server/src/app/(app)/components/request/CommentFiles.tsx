import { commentFileUrl, type CommentFileView } from '../../../../core/requests/comments'

export function CommentFiles({ files }: { files: CommentFileView[] }) {
  if (files.length === 0) return null
  return (
    <ul className="small m-0 flex list-none flex-wrap items-end gap-3 p-0">
      {files.map((file) => {
        const url = commentFileUrl(file)
        return (
          <li key={file.id}>
            <a href={url} target="_blank" rel="noreferrer" className="grid gap-1 text-primary hover:underline">
              {file.contentType.startsWith('image/') && (
                <img src={url} alt={file.name} className="max-h-32 rounded-sm border border-border" />
              )}
              {file.name}
            </a>
          </li>
        )
      })}
    </ul>
  )
}
