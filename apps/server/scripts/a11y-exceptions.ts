export const exceptions: Record<string, string> = {
  '/admin/[[...segments]]': 'Payload admin UI, not our markup; hidden from users (no /admin link)',
}
