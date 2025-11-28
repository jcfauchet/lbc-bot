export interface EmailData {
  to: string
  subject: string
  html: string
  from?: string
}

export interface IMailer {
  send(data: EmailData): Promise<void>
}

