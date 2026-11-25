import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Breadcrumbs } from '../../src/app/(app)/components/Breadcrumbs'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

afterEach(cleanup)

describe('Breadcrumbs', () => {
  it('names the Releases page after its nav entry', () => {
    pathname = '/releases'
    render(createElement(Breadcrumbs))
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('Releases')
  })
})
