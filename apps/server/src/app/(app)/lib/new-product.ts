/** Short name derived from a Product name: lowercase letters, digits and dashes. */
export const slugOf = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Value of the Repository select's "Other..." option; the typed `owner/name` is posted as `repoOther`. */
export const OTHER_REPO = '__other'
