type Fields = {
  kind: string
  criterion?: string | undefined
  sha?: string | undefined
  body?: string | undefined
  url?: string | undefined
  upload?: unknown
  screen?: string | undefined
  width?: number | undefined
}

const formsIssues = (value: Fields): string[] => {
  const forms = [value.body, value.url, value.upload].filter((form) => form !== undefined).length
  return forms === 1 ? [] : ['give exactly one of body, url and upload']
}

const mockupIssues = (value: Fields): string[] =>
  value.upload && value.criterion === undefined && value.sha === undefined
    ? []
    : ['a mockup is an upload and has no criterion and no sha']

const pairedIssues = (value: Fields): string[] =>
  value.upload && value.screen && value.width && value.sha && value.criterion === undefined
    ? []
    : ['a before or after is an upload with a screen, a width and a sha, and has no criterion']

const plainIssues = (value: Fields): string[] => {
  const paired = value.screen !== undefined || value.width !== undefined
  const loose = value.upload && value.kind !== 'screenshot'
  return [
    ...(paired ? ['a screen and a width belong to a before or after'] : []),
    ...(loose ? ['an upload is a mockup, a screenshot, a before or an after'] : []),
  ]
}

export const inputIssues = (value: Fields): string[] => {
  if (value.kind === 'mockup') return [...formsIssues(value), ...mockupIssues(value)]
  if (value.kind === 'before' || value.kind === 'after') return [...formsIssues(value), ...pairedIssues(value)]
  return [...formsIssues(value), ...plainIssues(value)]
}
