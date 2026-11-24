import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BeforeAfter, missingOf } from '../../src/app/(app)/components/ticket/BeforeAfter'
import type { ScreenPair } from '../../src/core/views/ticket'

const shot = (id: number, kind: 'before' | 'after') => ({ id, kind, screen: 'List', width: 1280, sha: 'h1' })
const mockup = { id: 9, caption: 'List (wide)', screen: 'List', bytes: 2, html: false }
const pair = (extra: Partial<ScreenPair> = {}): ScreenPair => ({
  screen: 'List',
  width: 1280,
  before: shot(1, 'before'),
  after: shot(2, 'after'),
  mockup,
  ...extra,
})

afterEach(cleanup)

describe('BeforeAfter', () => {
  it('shows nothing without pairs', () => {
    const { container } = render(createElement(BeforeAfter, { pairs: [] }))
    expect(container.textContent).toBe('')
  })

  it('flips before and after in the same frame without changing its size', () => {
    render(createElement(BeforeAfter, { pairs: [pair()] }))
    const flip = screen.getByRole('button', { name: 'Flip before / after' })
    const frame = () => screen.getAllByRole('img').find((img) => img.className.includes('max-w-3xl'))!
    const classes = frame().className
    expect(frame().getAttribute('src')).toBe('/api/attachments/1')
    fireEvent.click(flip)
    expect(frame().getAttribute('src')).toBe('/api/attachments/2')
    expect(frame().className).toBe(classes)
    fireEvent.click(flip)
    expect(frame().getAttribute('src')).toBe('/api/attachments/1')
  })

  it('opens the viewer on the clicked picture with before, after and plan in order', () => {
    render(createElement(BeforeAfter, { pairs: [pair()] }))
    fireEvent.click(screen.getByRole('button', { name: 'After: List, 1280 px' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('2 of 3')).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(within(dialog).getByText('3 of 3')).toBeTruthy()
    expect(within(dialog).getByRole('img', { name: 'Plan: List' })).toBeTruthy()
  })

  it('says what is missing and offers no flip', () => {
    render(createElement(BeforeAfter, { pairs: [pair({ after: null })] }))
    expect(screen.getByText('Missing: the after picture.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Flip before / after' })).toBeNull()
    expect(missingOf(pair({ before: null, after: null }))).toBe('Missing: a before and an after picture.')
    expect(missingOf(pair({ before: null }))).toBe('Missing: the before picture.')
    expect(missingOf(pair())).toBeNull()
  })
})

describe('BeforeAfter on a phone', () => {
  it('switches between the mockup and the after picture', () => {
    render(createElement(BeforeAfter, { pairs: [pair()] }))
    const mockupButton = screen.getByRole('button', { name: 'Mockup' })
    const phone = () => mockupButton.parentElement!.parentElement!.querySelector('img')!
    expect(phone().getAttribute('src')).toBe('/api/attachments/2')
    fireEvent.click(mockupButton)
    expect(phone().getAttribute('src')).toBe('/api/attachments/9')
    fireEvent.click(screen.getByRole('button', { name: 'After' }))
    expect(phone().getAttribute('src')).toBe('/api/attachments/2')
  })
})
