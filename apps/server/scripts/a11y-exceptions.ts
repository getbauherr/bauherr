/** Routes (`page.tsx`, route groups removed) that `e2e/a11y.spec.ts` does not scan, each with the reason. */
export const exceptions: Record<string, string> = {
  '/admin/[[...segments]]': 'Payload admin UI, not our markup; hidden from users (no /admin link)',
}
