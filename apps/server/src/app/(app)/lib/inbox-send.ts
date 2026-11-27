import { commentOnRequestAction, startRequestConversation } from '../(shell)/requests/actions'

export const sendComment = async (recordId: number, text: string): Promise<string | null> => {
  const conversationId = await startRequestConversation(recordId)
  return (await commentOnRequestAction({ recordId, conversationId, text, fileIds: [] })).error ?? null
}
