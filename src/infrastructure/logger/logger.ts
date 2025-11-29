import { env } from '@/infrastructure/config/env'

const getTimestamp = () => {
  return new Date().toISOString().replace('T', ' ').substring(0, 19)
}

export function logError(context: string, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined
  const timestamp = getTimestamp()
  
  console.error(`${timestamp} [ERROR]: [${context}] ${errorMessage}`)
  if (errorStack) {
    console.error(errorStack)
  }
}

export function logInfo(context: string, message: string, meta?: any) {
  const timestamp = getTimestamp()
  if (meta) {
    console.log(`${timestamp} [INFO]: [${context}] ${message}`, meta)
  } else {
    console.log(`${timestamp} [INFO]: [${context}] ${message}`)
  }
}

export function logDebug(context: string, message: string, meta?: any) {
  if (env.NODE_ENV === 'development') {
    const timestamp = getTimestamp()
    if (meta) {
      console.debug(`${timestamp} [DEBUG]: [${context}] ${message}`, meta)
    } else {
      console.debug(`${timestamp} [DEBUG]: [${context}] ${message}`)
    }
  }
}

export function logWarn(context: string, message: string, meta?: any) {
  const timestamp = getTimestamp()
  if (meta) {
    console.warn(`${timestamp} [WARN]: [${context}] ${message}`, meta)
  } else {
    console.warn(`${timestamp} [WARN]: [${context}] ${message}`)
  }
}

