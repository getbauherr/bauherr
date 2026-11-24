export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type RetroModel = (workspace: number, system: string, turns: ChatTurn[]) => Promise<string>
