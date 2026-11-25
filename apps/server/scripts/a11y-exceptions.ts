export const exceptions: Record<string, string> = {
  '/admin/[[...segments]]': 'Payload admin UI, not our markup; hidden from users (no /admin link)',
  '/requests': 'Product owner only, a 404 for the worker admin; scanned by e2e/product-owner.spec.ts',
  '/requests/[id]': 'Product owner only, a 404 for the worker admin; one heading and a link, covered by the same spec',
}
