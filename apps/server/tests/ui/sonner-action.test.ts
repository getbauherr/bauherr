import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../../src/app/(app)/components/ui/sonner'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
afterEach(cleanup)

describe('toast actions', () => {
  it('use the accent tokens, not the ink colour of the toast text', async () => {
    render(createElement(Toaster))
    act(() => void toast('Brief approved', { action: { label: 'Undo', onClick: vi.fn() } }))
    const undo = await screen.findByText('Undo')
    expect(undo.className).toContain('!bg-primary')
    expect(undo.className).toContain('!text-primary-foreground')
  })
})
