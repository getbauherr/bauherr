import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffBlock } from '../../src/app/(app)/components/ticket/DiffBlock'
import { MermaidBlock } from '../../src/app/(app)/components/ticket/MermaidBlock'
import { MockupFrame } from '../../src/app/(app)/components/ticket/MockupFrame'
import { diffLines, driftOf } from '../../src/core/record/diff'

vi.mock('mermaid', () => ({
  default: {
    initialize: () => undefined,
    render: async (_id: string, source: string) => {
      if (source.includes('broken')) throw new Error('Parse error')
      return { svg: '<svg data-testid="drawn"></svg>' }
    },
  },
}))

afterEach(cleanup)

describe('DiffBlock', () => {
  it('colours added lines green and removed lines red and keeps the text', () => {
    render(createElement(DiffBlock, { lines: diffLines('+new line\n-old line\n same'), label: 'Shape' }))
    const added = screen.getByText('new line').closest('li')!
    const removed = screen.getByText('old line').closest('li')!
    expect(added.className).toContain('text-ok')
    expect(removed.className).toContain('text-destructive')
    expect(screen.getByText('same').closest('li')!.className).not.toContain('text-')
    expect(screen.getByRole('region', { name: 'Shape' }).className).toContain('overflow-x-auto')
  })

  it('puts a not-in-plan chip on every drift line and on no planned line', () => {
    render(createElement(DiffBlock, { lines: driftOf('+planned', '+planned\n+extra'), label: 'Built' }))
    expect(screen.getAllByText('not in plan')).toHaveLength(1)
    expect(screen.getByText('extra').closest('li')!.textContent).toContain('not in plan')
  })
})

describe('MermaidBlock', () => {
  it('draws valid source as a diagram', async () => {
    render(createElement(MermaidBlock, { source: 'flowchart LR\n A --> B' }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Flow diagram' })).toBeTruthy())
  })

  it('falls back to the source text with a note when the source is broken', async () => {
    render(createElement(MermaidBlock, { source: 'broken ->' }))
    await waitFor(() => expect(screen.getByText(/could not be drawn/)).toBeTruthy())
    expect(screen.getByText('broken ->')).toBeTruthy()
  })
})

describe('MockupFrame', () => {
  it('frames the page with allow-scripts only and offers the full size', () => {
    const mockup = { id: 4, caption: 'Run page', screen: 'Run page', bytes: 9, html: true }
    render(createElement(MockupFrame, { mockup }))
    const frame = screen.getByTitle('Run page')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toBe('/api/attachments/4')
    expect(screen.getByRole('link', { name: 'Open full size' }).getAttribute('href')).toBe('/api/attachments/4')
  })
})
