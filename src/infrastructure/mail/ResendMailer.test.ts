import { describe, it } from 'vitest'
import { ResendMailer } from './ResendMailer'
import { env } from '../config/env'

describe('ResendMailer', () => {
  it('should send an email', async () => {
    const mailer = new ResendMailer(env.RESEND_API_KEY!)
    await mailer.send({
      to: 'marika.yaros@gmail.com',
      subject: '🎯 1 bonne affaire trouvée',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Email - LBC Bot</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
                padding: 40px 30px; 
                text-align: center;">
      <h1 style="margin: 0; font-size: 32px; font-weight: 600;">🎯 1 bonne affaire trouvée</h1>
      <p style="margin: 15px 0 0 0; font-size: 16px; opacity: 0.95;">
        Notification de test - LBC Bot
      </p>
    </div>
    
    <div style="padding: 40px 30px;">
      <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                  padding: 25px;
                  border-radius: 8px;
                  margin-bottom: 25px;
                  color: white;">
        <h2 style="margin: 0 0 15px 0; font-size: 22px;">📱 iPhone 13 Pro - 256 Go</h2>
        <p style="margin: 5px 0; opacity: 0.95;">📍 Paris - Île-de-France</p>
        <div style="margin-top: 20px;">
          <span style="font-size: 28px; font-weight: bold;">750 €</span>
          <span style="margin-left: 15px; font-size: 16px; opacity: 0.9;">
            Estimé: 900 € - 1100 €
          </span>
        </div>
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.3);">
          <strong style="opacity: 0.95;">💵 Marge estimée:</strong>
          <span style="margin-left: 10px; font-size: 18px; font-weight: 600;">+150 € minimum</span>
        </div>
      </div>
      
      <div style="background: #f8f9fa;
                  padding: 20px;
                  border-radius: 8px;
                  border-left: 4px solid #667eea;">
        <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;">💡 Analyse IA</h3>
        <p style="margin: 0; color: #666; line-height: 1.6;">
          Cette annonce présente un excellent rapport qualité-prix. L'iPhone 13 Pro est en très bon état, 
          avec tous les accessoires d'origine. Le prix est nettement en dessous du marché, offrant une 
          marge intéressante pour la revente.
        </p>
      </div>
      
      <div style="margin-top: 30px; text-align: center;">
        <a href="https://www.leboncoin.fr" 
           style="display: inline-block;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  text-decoration: none;
                  padding: 14px 32px;
                  border-radius: 6px;
                  font-weight: 600;
                  font-size: 16px;">
          Voir l'annonce →
        </a>
      </div>
    </div>
    
    <div style="background: #f8f9fa; 
                padding: 25px 30px; 
                text-align: center; 
                border-top: 1px solid #e9ecef;
                color: #6c757d;">
      <p style="margin: 0; font-size: 14px;">
        🤖 Bot de sourcing Le Bon Coin avec IA
      </p>
      <p style="margin: 10px 0 0 0; font-size: 12px; opacity: 0.8;">
        Email de test généré le ${new Date().toLocaleDateString('fr-FR', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </p>
    </div>
  </div>
</body>
</html>
      `,
      from: 'LBC Bot <bot@vrx-conseil.com>',
    })
  })
})