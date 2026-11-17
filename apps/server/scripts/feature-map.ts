import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Feature, type FeatureMap, parseMap, PROOFS, STATUSES } from '../src/lib/feature-map'

export { PROOFS, STATUSES }
export type { Feature, FeatureMap }

export const root = fileURLToPath(new URL('../../../', import.meta.url))
export const mapFile = `${root}docs/feature-map.yaml`
export const outputs = [`${root}docs/features.md`, `${root}docs/site/docs/features.md`]

const LABEL = { live: 'Live', 'hard-to-find': 'Live, hard to find', 'no-ui': 'No UI', 'in-progress': 'In progress' }

export const loadMap = (): FeatureMap => parseMap(readFileSync(mapFile, 'utf8'))

export const render = (map: FeatureMap): string => {
  const areas = [...new Set(map.features.map((f) => f.area))]
  const sections = areas.map((area) => {
    const rows = map.features.filter((f) => f.area === area).map((f) => `| ${f.title} | ${f.summary} | ${f.reach} | ${LABEL[f.status]} |`)
    const table = ['| Feature | What it does | Where | Status |', '|---|---|---|---|', ...rows].join('\n')
    return [`## ${area}`, table, map.notes[area]].filter(Boolean).join('\n\n')
  })
  const gaps = map.notes['Known gaps'] ? [`## Known gaps\n\n${map.notes['Known gaps']}`] : []
  return [
    'Generated from docs/feature-map.yaml by `pnpm --filter server feature-map`; do not edit.',
    '# Features',
    map.intro,
    map.legend,
    ...sections,
    ...gaps,
  ].join('\n\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = render(loadMap())
  for (const file of outputs) writeFileSync(file, text)
}
