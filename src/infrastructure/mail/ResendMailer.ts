import { Resend } from 'resend'
import { IMailer, EmailData } from './IMailer'

export class ResendMailer implements IMailer {
  private client: Resend

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }

  async send(data: EmailData): Promise<void> {
    try {
      await this.client.emails.send({
        from: `LBC Bot <${data.from}>`,
        to: data.to,
        subject: data.subject,
        html: data.html,
      })
    } catch (error) {
      console.error('Failed to send email:', error)
      throw new Error('Email sending failed')
    }
  }
}

