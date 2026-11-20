import { createContext, useContext } from 'react'
import type { FormState } from '../lib/settings'

export const FormStateContext = createContext<FormState>({})

export const useFieldError = (name: string): string | undefined => useContext(FormStateContext).fields?.[name]
