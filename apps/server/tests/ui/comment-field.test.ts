import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { CommentField } from '../../src/app/(app)/components/ticket/CommentField'

afterEach(cleanup)

describe('CommentField', () => {
  it('has a comment box and no Applies to picker', () => {
    const { getByLabelText, queryByLabelText, queryByRole } = render(
      createElement(CommentField, {
        value: '',
        max: 100,
        hint: null,
        missing: null,
        areaRef: null,
        onChange: () => {},
      }),
    )
    expect(getByLabelText('Comment')).toBeTruthy()
    expect(queryByLabelText('Applies to')).toBeNull()
    expect(queryByRole('combobox')).toBeNull()
  })
})
