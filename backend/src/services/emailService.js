const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransporter({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    this.fromAddress = process.env.EMAIL_FROM || 'Hebrew Transcription <noreply@example.com>';
  }

  async sendTranscriptionComplete(to, transcription, attachments = []) {
    try {
      const subject = `Transcription Complete: ${transcription.originalFilename}`;
      
      const htmlContent = this.generateTranscriptionEmailHTML(transcription);
      const textContent = this.generateTranscriptionEmailText(transcription);
      
      const mailOptions = {
        from: this.fromAddress,
        to: to,
        subject: subject,
        text: textContent,
        html: htmlContent,
        attachments: attachments
      };
      
      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Transcription email sent to ${to}:`, result.messageId);
      return result;
    } catch (error) {
      logger.error('Failed to send transcription email:', error);
      throw new Error(`Email delivery failed: ${error.message}`);
    }
  }

  async sendTranscriptionError(to, transcription, errorMessage) {
    try {
      const subject = `Transcription Failed: ${transcription.originalFilename}`;
      
      const htmlContent = `
        <!DOCTYPE html>
        <html dir="rtl" lang="he">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Transcription Failed</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f4f4f4; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            .header { background: #dc3545; color: white; padding: 20px; border-radius: 10px 10px 0 0; margin: -20px -20px 20px -20px; }
            .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚫 Transcription Failed</h1>
            </div>
            
            <p>We're sorry, but the transcription of your audio file failed.</p>
            
            <h3>File Details:</h3>
            <ul>
              <li><strong>File Name:</strong> ${transcription.originalFilename}</li>
              <li><strong>File Size:</strong> ${(transcription.fileSize / 1024 / 1024).toFixed(2)} MB</li>
              <li><strong>Upload Time:</strong> ${new Date(transcription.createdAt).toLocaleString('he-IL')}</li>
            </ul>
            
            <div class="error">
              <h4>Error Details:</h4>
              <p>${errorMessage}</p>
            </div>
            
            <h3>What you can do:</h3>
            <ul>
              <li>Check that your audio file is in a supported format (MP3, WAV, M4A, AAC, FLAC)</li>
              <li>Ensure the file is not corrupted</li>
              <li>Try uploading the file again</li>
              <li>Contact support if the problem persists</li>
            </ul>
            
            <div class="footer">
              <p>Hebrew Call Transcription Service<br>
              <a href="mailto:support@example.com">support@example.com</a></p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      const textContent = `
Transcription Failed

We're sorry, but the transcription of your audio file failed.

File Details:
- File Name: ${transcription.originalFilename}
- File Size: ${(transcription.fileSize / 1024 / 1024).toFixed(2)} MB
- Upload Time: ${new Date(transcription.createdAt).toLocaleString('he-IL')}

Error: ${errorMessage}

What you can do:
- Check that your audio file is in a supported format (MP3, WAV, M4A, AAC, FLAC)
- Ensure the file is not corrupted
- Try uploading the file again
- Contact support if the problem persists

Hebrew Call Transcription Service
support@example.com
      `;
      
      const mailOptions = {
        from: this.fromAddress,
        to: to,
        subject: subject,
        text: textContent,
        html: htmlContent
      };
      
      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Error notification email sent to ${to}:`, result.messageId);
      return result;
    } catch (error) {
      logger.error('Failed to send error notification email:', error);
      throw new Error(`Error email delivery failed: ${error.message}`);
    }
  }

  generateTranscriptionEmailHTML(transcription) {
    const speakerSections = this.formatSpeakerSections(transcription.speakerLabels);
    const confidence = transcription.confidence ? (transcription.confidence * 100).toFixed(1) : 'N/A';
    
    return `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Transcription Complete</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
          .header { background: #007bff; color: white; padding: 20px; border-radius: 10px 10px 0 0; margin: -20px -20px 20px -20px; }
          .transcription { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 15px 0; border-right: 4px solid #007bff; }
          .speaker { margin: 10px 0; padding: 10px; background: #e9ecef; border-radius: 5px; }
          .speaker-label { font-weight: bold; color: #495057; }
          .stats { display: flex; justify-content: space-between; margin: 15px 0; }
          .stat { text-align: center; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Transcription Complete</h1>
          </div>
          
          <p>Your Hebrew audio transcription has been completed successfully!</p>
          
          <h3>File Details:</h3>
          <ul>
            <li><strong>File Name:</strong> ${transcription.originalFilename}</li>
            <li><strong>Duration:</strong> ${this.formatDuration(transcription.duration)}</li>
            <li><strong>Processing Time:</strong> ${this.formatProcessingTime(transcription.processingTime)}</li>
            <li><strong>Confidence Score:</strong> ${confidence}%</li>
          </ul>
          
          <div class="transcription">
            <h3>🎙️ Transcription:</h3>
            ${speakerSections || `<p>${transcription.transcriptionText}</p>`}
          </div>
          
          ${transcription.lowConfidenceWords && transcription.lowConfidenceWords.length > 0 ? `
            <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <h4>⚠️ Words with Lower Confidence:</h4>
              <p>The following words had lower confidence scores and may need review:</p>
              <p>${transcription.lowConfidenceWords.map(w => w.word).join(', ')}</p>
            </div>
          ` : ''}
          
          <div class="footer">
            <p>Hebrew Call Transcription Service<br>
            Generated on ${new Date().toLocaleString('he-IL')}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateTranscriptionEmailText(transcription) {
    const confidence = transcription.confidence ? (transcription.confidence * 100).toFixed(1) : 'N/A';
    
    let text = `
Hebrew Audio Transcription Complete

Your Hebrew audio transcription has been completed successfully!

File Details:
- File Name: ${transcription.originalFilename}
- Duration: ${this.formatDuration(transcription.duration)}
- Processing Time: ${this.formatProcessingTime(transcription.processingTime)}
- Confidence Score: ${confidence}%

Transcription:
${transcription.transcriptionText}
`;
    
    if (transcription.lowConfidenceWords && transcription.lowConfidenceWords.length > 0) {
      text += `\nWords with Lower Confidence:\n${transcription.lowConfidenceWords.map(w => w.word).join(', ')}\n`;
    }
    
    text += `\nHebrew Call Transcription Service\nGenerated on ${new Date().toLocaleString('he-IL')}`;
    
    return text;
  }

  formatSpeakerSections(speakerLabels) {
    if (!speakerLabels || speakerLabels.length === 0) return null;
    
    return speakerLabels.map(segment => `
      <div class="speaker">
        <div class="speaker-label">${segment.speaker} (${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}):</div>
        <p>${segment.text}</p>
      </div>
    `).join('');
  }

  formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  formatProcessingTime(milliseconds) {
    if (!milliseconds) return 'Unknown';
    const seconds = Math.floor(milliseconds / 1000);
    return `${seconds} seconds`;
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }
}

module.exports = new EmailService();
