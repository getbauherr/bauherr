import { describe, expect, it } from 'vitest'
import { reportOf, sumTranscript } from '../../../pack/hooks/report-usage'

const line = (id: string, model: string, usage: object, extra: object = {}) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-17T10:00:00Z', message: { id, model, usage }, ...extra })

describe('report-usage hook', () => {
  it('sums usage per model once per message id and skips synthetic and broken lines', () => {
    const text = [
      line('m1', 'claude-a', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }),
      line('m1', 'claude-a', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }),
      line('m2', 'claude-a', { input_tokens: 1, output_tokens: 2 }, { timestamp: '2026-11-17T09:00:00Z' }),
      line('m3', 'claude-b', { output_tokens: 4 }),
      line('m4', '<synthetic>', { input_tokens: 99 }),
      'not json',
    ].join('\n')
    expect(sumTranscript(text)).toEqual({ models: { 'claude-a': [11, 7, 100, 7], 'claude-b': [0, 4, 0, 0] }, firstAt: '2026-11-17T09:00:00Z' })
  })

  it('a SubagentStop reports the subagent transcript under its own session key', () => {
    expect(reportOf({ session_id: 's1', transcript_path: '/t/main.jsonl', agent_id: 'a9', agent_transcript_path: '/t/agent.jsonl' })).toEqual({ claudeSession: 's1:a9', path: '/t/agent.jsonl' })
    expect(reportOf({ session_id: 's1', transcript_path: '/t/main.jsonl' })).toEqual({ claudeSession: 's1', path: '/t/main.jsonl' })
    expect(reportOf({ session_id: 's1', agent_id: 'a9' })).toBeNull()
  })
})
