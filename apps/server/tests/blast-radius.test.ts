import { describe, expect, it } from 'vitest'
import { blastRadiusFailures } from '../src/lib/pre-review'

describe('blastRadiusFailures', () => {
  it('passes with the section and one ladder value', () => {
    expect(blastRadiusFailures('## Evidence\nx\n\n## Blast radius\nSafe because the table is new. Sure: `Test covers it`\n\n## Verification\nx')).toEqual([])
  })

  it('names the missing section', () => {
    const [f] = blastRadiusFailures('## Evidence\nx')
    expect(f).toContain('no `## Blast radius` section')
    expect(f).toContain('`reproduced in the running app`')
  })

  it('refuses an empty section, no value and several values', () => {
    expect(blastRadiusFailures('## Blast radius\n\n## Evidence\nx')[0]).toContain('no `## Blast radius` section')
    expect(blastRadiusFailures('## Blast radius\nsafe, trust me')[0]).toContain('names no confidence value')
    expect(blastRadiusFailures('## Blast radius\nread the code, then test covers it')[0]).toContain('names 2 confidence values')
  })

  it('ignores values outside the section', () => {
    expect(blastRadiusFailures('## Why\nread the code\n## Blast radius\nsafe')[0]).toContain('names no confidence value')
  })
})
