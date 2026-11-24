import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ImageGallery } from '../../src/app/(app)/components/ticket/ImageGallery'
import { swipeStep } from '../../src/app/(app)/components/ticket/ImageViewer'

const images = [1, 2, 3, 4].map((id) => ({ id, caption: `Picture ${id}` }))

const openSecond = () => {
  render(createElement(ImageGallery, { images }))
  const thumbnail = screen.getByRole('button', { name: 'Picture 2' })
  thumbnail.focus()
  fireEvent.click(thumbnail)
  return { thumbnail, dialog: screen.getByRole('dialog') }
}

afterEach(cleanup)

describe('ImageGallery', () => {
  it('opens at the clicked picture and ArrowRight shows the next one', () => {
    const { dialog } = openSecond()
    expect(within(dialog).getByText('2 of 4')).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(within(dialog).getByText('3 of 4')).toBeTruthy()
    expect(within(dialog).getByRole('img', { name: 'Picture 3' })).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(within(dialog).getByText('2 of 4')).toBeTruthy()
  })

  it('fits to screen by default and toggles to natural size and back', () => {
    const { dialog } = openSecond()
    const picture = within(dialog).getByRole('img', { name: 'Picture 2' })
    const toggle = within(dialog).getByRole('button', { name: 'Fit to screen' })
    expect(picture.className).toContain('max-h-full')
    fireEvent.click(toggle)
    expect(picture.className).toContain('max-w-none')
    expect(picture.className).not.toContain('max-h-full')
    expect(within(dialog).getByRole('button', { name: 'Actual size' })).toBeTruthy()
    fireEvent.click(picture)
    expect(picture.className).toContain('max-h-full')
    expect(within(dialog).getByRole('button', { name: 'Fit to screen' })).toBeTruthy()
  })

  it('links the original attachment in a new tab', () => {
    const { dialog } = openSecond()
    const link = within(dialog).getByRole('link', { name: 'Open in new tab' })
    expect(link.getAttribute('href')).toBe('/api/attachments/2')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('closes with Close and returns focus to the clicked thumbnail', async () => {
    const { thumbnail, dialog } = openSecond()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(thumbnail))
  })

  it('has labelled controls and no axe violations when open', async () => {
    const { dialog } = openSecond()
    for (const name of ['Previous', 'Next', 'Fit to screen', 'Close']) {
      expect(within(dialog).getByRole('button', { name })).toBeTruthy()
    }
    const { violations } = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
    expect(violations.map((v) => v.id)).toEqual([])
  })

  it('swiping left shows the next picture and right the previous one', () => {
    const { dialog } = openSecond()
    const area = within(dialog).getByRole('img', { name: 'Picture 2' }).closest('div')!
    const touch = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true })
      const point = [{ clientX: x, clientY: 100 }]
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : point })
      Object.defineProperty(event, 'changedTouches', { value: point })
      fireEvent(area, event)
    }
    const swipe = (from: number, to: number) => {
      touch('touchstart', from)
      touch('touchend', to)
    }
    swipe(300, 100)
    expect(within(dialog).getByText('3 of 4')).toBeTruthy()
    swipe(100, 300)
    expect(within(dialog).getByText('2 of 4')).toBeTruthy()
  })

  it('reads a short or mostly vertical drag as no swipe', () => {
    expect(swipeStep(-20, 0)).toBe(0)
    expect(swipeStep(-80, 200)).toBe(0)
    expect(swipeStep(-80, 10)).toBe(1)
    expect(swipeStep(80, 10)).toBe(-1)
  })
})
