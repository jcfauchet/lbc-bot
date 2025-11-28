import winston from 'winston'
import { env } from '@/infrastructure/config/env'

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message}`
  })
)

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  ],
})

export function logError(context: string, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined
  
  logger.error(`[${context}] ${errorMessage}`, { stack: errorStack })
}

export function logInfo(context: string, message: string, meta?: any) {
  logger.info(`[${context}] ${message}`, meta)
}

export function logDebug(context: string, message: string, meta?: any) {
  logger.debug(`[${context}] ${message}`, meta)
}

export function logWarn(context: string, message: string, meta?: any) {
  logger.warn(`[${context}] ${message}`, meta)
}

