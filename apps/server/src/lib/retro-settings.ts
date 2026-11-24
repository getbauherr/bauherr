export const DEFAULT_FACTORY_REPO = 'getbauherr/bauherr'

export const factoryRepo = (): string => process.env.BAUHERR_FACTORY_REPO || DEFAULT_FACTORY_REPO
