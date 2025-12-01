import { Resend } from 'resend'
import { IMailer, EmailData } from './IMailer'

export class ResendMailer implements IMailer {
  private client: Resend

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }

  async send(data: EmailData): Promise<void> {
    const to = Array.isArray(data.to) ? data.to : [data.to]
    
    try {
      for (const email of to) {
        await this.client.emails.send({
          from: data.from || 'LBC Bot <bot@yourdomain.com>',
          to: email,
          subject: data.subject,
          html: data.html,
        })
      }
    } catch (error) {
      console.error('Failed to send email:', error)
      throw new Error('Email sending failed')
    }
  }
}

