const logger = require('../utils/logger');
const { Transcription } = require('../models');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const { Parser } = require('json2csv');
const xml2js = require('xml2js');
const archiver = require('archiver');
const moment = require('moment');

/**
 * Advanced Export Service
 * Provides comprehensive export capabilities with multiple formats and custom templates
 */
class ExportService {
  constructor() {
    this.exportTemplates = new Map();
    this.customFormats = new Map();
    this.exportQueue = new Map(); // For async exports
    this.loadBuiltInTemplates();
  }

  /**
   * Export transcription in specified format
   */
  async exportTranscription(transcription, format, options = {}) {
    try {
      const exportId = uuidv4();
      const startTime = Date.now();

      logger.info(`Starting export ${exportId} for transcription ${transcription.id} in format ${format}`);

      // Resolve transcription data if only ID provided
      if (typeof transcription === 'string') {
        transcription = await Transcription.findByPk(transcription);
        if (!transcription) {
          throw new Error('Transcription not found');
        }
      }

      // Validate format
      if (!this.isFormatSupported(format)) {
        throw new Error(`Unsupported export format: ${format}`);
      }

      // Prepare export data
      const exportData = await this.prepareExportData(transcription, options);

      // Generate export based on format
      let result;
      switch (format.toLowerCase()) {
        case 'txt':
          result = await this.exportToText(exportData, options);
          break;
        case 'json':
          result = await this.exportToJson(exportData, options);
          break;
        case 'csv':
          result = await this.exportToCsv(exportData, options);
          break;
        case 'xml':
          result = await this.exportToXml(exportData, options);
          break;
        case 'pdf':
          result = await this.exportToPdf(exportData, options);
          break;
        case 'docx':
          result = await this.exportToDocx(exportData, options);
          break;
        case 'srt':
          result = await this.exportToSrt(exportData, options);
          break;
        case 'vtt':
          result = await this.exportToVtt(exportData, options);
          break;
        case 'html':
          result = await this.exportToHtml(exportData, options);
          break;
        case 'markdown':
          result = await this.exportToMarkdown(exportData, options);
          break;
        default:
          // Check custom formats
          if (this.customFormats.has(format)) {
            result = await this.exportToCustomFormat(exportData, format, options);
          } else {
            throw new Error(`Export format not implemented: ${format}`);
          }
      }

      const duration = Date.now() - startTime;
      
      logger.info(`Completed export ${exportId} in ${duration}ms`, {
        transcriptionId: transcription.id,
        format,
        fileSize: result.size,
        filePath: result.filePath
      });

      return {
        exportId,
        transcriptionId: transcription.id,
        format,
        filePath: result.filePath,
        fileName: result.fileName,
        size: result.size,
        duration,
        createdAt: new Date(),
        downloadUrl: result.downloadUrl
      };

    } catch (error) {
      logger.error('Export failed:', error);
      throw error;
    }
  }

  /**
   * Prepare export data from transcription
   */
  async prepareExportData(transcription, options = {}) {
    const data = {
      // Basic transcription info
      id: transcription.id,
      originalFilename: transcription.originalFilename,
      transcriptionText: transcription.transcriptionText,
      language: transcription.language,
      confidence: transcription.confidence,
      duration: transcription.duration,
      status: transcription.status,
      createdAt: transcription.createdAt,
      updatedAt: transcription.updatedAt,

      // Processing metadata
      processingStartTime: transcription.processingStartTime,
      processingEndTime: transcription.processingEndTime,
      processingDuration: transcription.processingEndTime && transcription.processingStartTime 
        ? transcription.processingEndTime - transcription.processingStartTime : null,

      // Speaker information
      speakerLabels: transcription.speakerLabels || [],
      speakerCount: transcription.speakerLabels 
        ? new Set(transcription.speakerLabels.map(s => s.speaker)).size : 0,

      // Quality metrics
      lowConfidenceWords: transcription.lowConfidenceWords || [],
      qualityScore: this.calculateQualityScore(transcription),

      // File information
      fileSize: transcription.fileSize,
      filePath: transcription.filePath,

      // Additional metadata
      customVocabulary: transcription.customVocabulary,
      processingOptions: transcription.processingOptions || {},

      // Export metadata
      exportTimestamp: new Date().toISOString(),
      exportOptions: options,
      exportTemplate: options.template || 'default'
    };

    // Add Hebrew-specific data if available
    if (transcription.language === 'he-IL') {
      data.hebrewMetadata = {
        textDirection: 'rtl',
        scriptType: 'hebrew',
        characterCount: this.countHebrewCharacters(transcription.transcriptionText),
        wordCount: this.countHebrewWords(transcription.transcriptionText),
        sentenceCount: this.countHebrewSentences(transcription.transcriptionText)
      };
    }

    // Apply template if specified
    if (options.template && this.exportTemplates.has(options.template)) {
      const template = this.exportTemplates.get(options.template);
      data.templateData = await this.applyTemplate(template, data);
    }

    return data;
  }

  /**
   * Export to plain text format
   */
  async exportToText(data, options = {}) {
    const template = options.template || 'basic';
    let content = '';

    switch (template) {
      case 'detailed':
        content = this.generateDetailedTextContent(data);
        break;
      case 'simple':
        content = data.transcriptionText || 'No transcription available';
        break;
      case 'speakers':
        content = this.generateSpeakerBasedTextContent(data);
        break;
      default:
        content = this.generateBasicTextContent(data);
    }

    return await this.writeToFile(content, 'txt', options);
  }

  /**
   * Export to JSON format
   */
  async exportToJson(data, options = {}) {
    const jsonData = {
      transcription: data,
      metadata: {
        exportedAt: new Date().toISOString(),
        exportVersion: '1.0',
        format: 'json'
      }
    };

    // Apply filtering if specified
    if (options.fields) {
      jsonData.transcription = this.filterFields(data, options.fields);
    }

    const content = JSON.stringify(jsonData, null, options.pretty ? 2 : 0);
    return await this.writeToFile(content, 'json', options);
  }

  /**
   * Export to CSV format
   */
  async exportToCsv(data, options = {}) {
    let csvData;

    if (data.speakerLabels && data.speakerLabels.length > 0) {
      // Export speaker segments
      csvData = data.speakerLabels.map(segment => ({
        speaker: segment.speaker,
        startTime: segment.start,
        endTime: segment.end,
        duration: segment.end - segment.start,
        text: segment.text,
        confidence: segment.confidence || data.confidence
      }));
    } else {
      // Export as single row
      csvData = [{
        filename: data.originalFilename,
        transcriptionText: data.transcriptionText,
        language: data.language,
        confidence: data.confidence,
        duration: data.duration,
        createdAt: data.createdAt
      }];
    }

    const fields = options.fields || Object.keys(csvData[0]);
    const parser = new Parser({ fields });
    const content = parser.parse(csvData);

    return await this.writeToFile(content, 'csv', options);
  }

  /**
   * Export to XML format
   */
  async exportToXml(data, options = {}) {
    const xmlData = {
      transcription: {
        $: {
          id: data.id,
          version: '1.0'
        },
        metadata: [{
          originalFilename: data.originalFilename,
          language: data.language,
          confidence: data.confidence,
          duration: data.duration,
          createdAt: data.createdAt
        }],
        content: [{
          text: data.transcriptionText
        }]
      }
    };

    // Add speaker data if available
    if (data.speakerLabels && data.speakerLabels.length > 0) {
      xmlData.transcription.speakers = [{
        speaker: data.speakerLabels.map(segment => ({
          $: {
            id: segment.speaker,
            start: segment.start,
            end: segment.end
          },
          text: segment.text
        }))
      }];
    }

    const builder = new xml2js.Builder({
      rootName: 'hebrewTranscription',
      xmldec: { version: '1.0', encoding: 'UTF-8' }
    });
    const content = builder.buildObject(xmlData);

    return await this.writeToFile(content, 'xml', options);
  }

  /**
   * Export to PDF format
   */
  async exportToPdf(data, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        const fileName = `transcription_${data.id}_${Date.now()}.pdf`;
        const filePath = path.join(this.getExportDirectory(options), fileName);

        const doc = new PDFDocument({
          margin: 50,
          font: 'Helvetica' // TODO: Add Hebrew font support
        });

        const stream = require('fs').createWriteStream(filePath);
        doc.pipe(stream);

        // Title
        doc.fontSize(16).text('Hebrew Transcription Report', { align: 'center' });
        doc.moveDown();

        // Metadata
        doc.fontSize(12)
           .text(`File: ${data.originalFilename}`)
           .text(`Language: ${data.language}`)
           .text(`Confidence: ${Math.round((data.confidence || 0) * 100)}%`)
           .text(`Duration: ${this.formatDuration(data.duration)}`)
           .text(`Created: ${moment(data.createdAt).format('YYYY-MM-DD HH:mm:ss')}`)
           .moveDown();

        // Transcription content
        doc.fontSize(14).text('Transcription:', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).text(data.transcriptionText || 'No transcription available', {
          align: 'left',
          lineGap: 2
        });

        // Speaker segments if available
        if (data.speakerLabels && data.speakerLabels.length > 0) {
          doc.addPage();
          doc.fontSize(14).text('Speaker Segments:', { underline: true });
          doc.moveDown();

          data.speakerLabels.forEach(segment => {
            doc.fontSize(11)
               .text(`${segment.speaker} [${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}]:`)
               .text(segment.text, { indent: 20 })
               .moveDown(0.5);
          });
        }

        doc.end();

        stream.on('finish', async () => {
          const stats = await fs.stat(filePath);
          resolve({
            filePath,
            fileName,
            size: stats.size,
            downloadUrl: this.generateDownloadUrl(fileName, options)
          });
        });

        stream.on('error', reject);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Export to DOCX format
   */
  async exportToDocx(data, options = {}) {
    try {
      const children = [];

      // Title
      children.push(
        new Paragraph({
          text: 'Hebrew Transcription Report',
          heading: HeadingLevel.TITLE,
          spacing: { after: 200 }
        })
      );

      // Metadata table
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'File: ', bold: true }),
            new TextRun(data.originalFilename || 'Unknown')
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Language: ', bold: true }),
            new TextRun(data.language || 'Unknown')
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Confidence: ', bold: true }),
            new TextRun(`${Math.round((data.confidence || 0) * 100)}%`)
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Duration: ', bold: true }),
            new TextRun(this.formatDuration(data.duration))
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Created: ', bold: true }),
            new TextRun(moment(data.createdAt).format('YYYY-MM-DD HH:mm:ss'))
          ]
        }),
        new Paragraph({ text: '', spacing: { after: 200 } })
      );

      // Transcription content
      children.push(
        new Paragraph({
          text: 'Transcription:',
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 100 }
        }),
        new Paragraph({
          text: data.transcriptionText || 'No transcription available',
          spacing: { after: 200 }
        })
      );

      // Speaker segments
      if (data.speakerLabels && data.speakerLabels.length > 0) {
        children.push(
          new Paragraph({
            text: 'Speaker Segments:',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 }
          })
        );

        data.speakerLabels.forEach(segment => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ 
                  text: `${segment.speaker} [${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}]: `, 
                  bold: true 
                }),
                new TextRun(segment.text)
              ],
              spacing: { after: 100 }
            })
          );
        });
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: children
        }]
      });

      const fileName = `transcription_${data.id}_${Date.now()}.docx`;
      const filePath = path.join(this.getExportDirectory(options), fileName);

      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(filePath, buffer);

      const stats = await fs.stat(filePath);

      return {
        filePath,
        fileName,
        size: stats.size,
        downloadUrl: this.generateDownloadUrl(fileName, options)
      };

    } catch (error) {
      throw new Error(`DOCX export failed: ${error.message}`);
    }
  }

  /**
   * Export to SRT subtitle format
   */
  async exportToSrt(data, options = {}) {
    if (!data.speakerLabels || data.speakerLabels.length === 0) {
      throw new Error('SRT export requires speaker segments data');
    }

    let content = '';
    
    data.speakerLabels.forEach((segment, index) => {
      const startTime = this.formatSrtTime(segment.start);
      const endTime = this.formatSrtTime(segment.end);
      
      content += `${index + 1}\n`;
      content += `${startTime} --> ${endTime}\n`;
      content += `${segment.text}\n\n`;
    });

    return await this.writeToFile(content, 'srt', options);
  }

  /**
   * Export to VTT subtitle format
   */
  async exportToVtt(data, options = {}) {
    if (!data.speakerLabels || data.speakerLabels.length === 0) {
      throw new Error('VTT export requires speaker segments data');
    }

    let content = 'WEBVTT\n\n';
    
    data.speakerLabels.forEach((segment, index) => {
      const startTime = this.formatVttTime(segment.start);
      const endTime = this.formatVttTime(segment.end);
      
      content += `${index + 1}\n`;
      content += `${startTime} --> ${endTime}\n`;
      content += `${segment.text}\n\n`;
    });

    return await this.writeToFile(content, 'vtt', options);
  }

  /**
   * Export to HTML format
   */
  async exportToHtml(data, options = {}) {
    const template = options.template || 'modern';
    
    let html = `<!DOCTYPE html>
<html lang="${data.language || 'he'}" dir="${data.language === 'he-IL' ? 'rtl' : 'ltr'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hebrew Transcription - ${data.originalFilename}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .metadata { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .transcription { background: white; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        .speaker-segment { margin-bottom: 15px; padding: 10px; background: #f9f9f9; border-left: 4px solid #007cba; }
        .speaker-label { font-weight: bold; color: #007cba; }
        .timestamp { color: #666; font-size: 0.9em; }
        ${data.language === 'he-IL' ? '.transcription { text-align: right; }' : ''}
    </style>
</head>
<body>
    <div class="header">
        <h1>Hebrew Transcription Report</h1>
    </div>
    
    <div class="metadata">
        <h2>File Information</h2>
        <p><strong>File:</strong> ${data.originalFilename}</p>
        <p><strong>Language:</strong> ${data.language}</p>
        <p><strong>Confidence:</strong> ${Math.round((data.confidence || 0) * 100)}%</p>
        <p><strong>Duration:</strong> ${this.formatDuration(data.duration)}</p>
        <p><strong>Created:</strong> ${moment(data.createdAt).format('YYYY-MM-DD HH:mm:ss')}</p>
    </div>`;

    if (data.speakerLabels && data.speakerLabels.length > 0) {
      html += `
    <div class="transcription">
        <h2>Speaker Segments</h2>`;
      
      data.speakerLabels.forEach(segment => {
        html += `
        <div class="speaker-segment">
            <div class="speaker-label">${segment.speaker} <span class="timestamp">[${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}]</span></div>
            <div>${segment.text}</div>
        </div>`;
      });
      
      html += `
    </div>`;
    } else {
      html += `
    <div class="transcription">
        <h2>Transcription</h2>
        <p>${data.transcriptionText || 'No transcription available'}</p>
    </div>`;
    }

    html += `
</body>
</html>`;

    return await this.writeToFile(html, 'html', options);
  }

  /**
   * Export to Markdown format
   */
  async exportToMarkdown(data, options = {}) {
    let content = `# Hebrew Transcription Report\n\n`;
    
    // Metadata
    content += `## File Information\n\n`;
    content += `- **File:** ${data.originalFilename}\n`;
    content += `- **Language:** ${data.language}\n`;
    content += `- **Confidence:** ${Math.round((data.confidence || 0) * 100)}%\n`;
    content += `- **Duration:** ${this.formatDuration(data.duration)}\n`;
    content += `- **Created:** ${moment(data.createdAt).format('YYYY-MM-DD HH:mm:ss')}\n\n`;

    // Transcription content
    if (data.speakerLabels && data.speakerLabels.length > 0) {
      content += `## Speaker Segments\n\n`;
      
      data.speakerLabels.forEach(segment => {
        content += `### ${segment.speaker} [${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}]\n\n`;
        content += `${segment.text}\n\n`;
      });
    } else {
      content += `## Transcription\n\n`;
      content += `${data.transcriptionText || 'No transcription available'}\n\n`;
    }

    return await this.writeToFile(content, 'md', options);
  }

  /**
   * Export to custom format
   */
  async exportToCustomFormat(data, format, options = {}) {
    const customFormat = this.customFormats.get(format);
    if (!customFormat) {
      throw new Error(`Custom format not found: ${format}`);
    }

    // Apply custom transformation
    const transformedData = await customFormat.transform(data, options);
    return await this.writeToFile(transformedData.content, transformedData.extension, options);
  }

  /**
   * Batch export multiple transcriptions
   */
  async batchExport(transcriptionIds, format, options = {}) {
    try {
      const batchId = uuidv4();
      const results = [];
      const errors = [];

      logger.info(`Starting batch export ${batchId}`, {
        transcriptionCount: transcriptionIds.length,
        format
      });

      // Export individual transcriptions
      for (const transcriptionId of transcriptionIds) {
        try {
          const result = await this.exportTranscription(transcriptionId, format, options);
          results.push(result);
        } catch (error) {
          errors.push({
            transcriptionId,
            error: error.message
          });
        }
      }

      // Create archive if requested
      let archivePath = null;
      if (options.createArchive) {
        archivePath = await this.createBatchArchive(results, batchId, options);
      }

      const batchResult = {
        batchId,
        format,
        totalTranscriptions: transcriptionIds.length,
        successCount: results.length,
        errorCount: errors.length,
        results,
        errors,
        archivePath,
        createdAt: new Date()
      };

      logger.info(`Completed batch export ${batchId}`, {
        successCount: results.length,
        errorCount: errors.length
      });

      return batchResult;

    } catch (error) {
      logger.error('Batch export failed:', error);
      throw error;
    }
  }

  /**
   * Create archive from batch export results
   */
  async createBatchArchive(results, batchId, options = {}) {
    const archivePath = path.join(
      this.getExportDirectory(options),
      `batch_export_${batchId}_${Date.now()}.zip`
    );

    return new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(archivePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        logger.info(`Batch archive created: ${archivePath} (${archive.pointer()} bytes)`);
        resolve(archivePath);
      });

      archive.on('error', (err) => {
        logger.error('Archive creation failed:', err);
        reject(err);
      });

      archive.pipe(output);

      // Add all export files to archive
      results.forEach(result => {
        archive.file(result.filePath, { name: result.fileName });
      });

      // Add batch summary
      const summary = {
        batchId,
        exportedAt: new Date().toISOString(),
        totalFiles: results.length,
        results: results.map(r => ({
          transcriptionId: r.transcriptionId,
          fileName: r.fileName,
          format: r.format,
          size: r.size
        }))
      };

      archive.append(JSON.stringify(summary, null, 2), { name: 'batch_summary.json' });
      archive.finalize();
    });
  }

  /**
   * Write content to file
   */
  async writeToFile(content, extension, options = {}) {
    const fileName = options.fileName || `transcription_${Date.now()}.${extension}`;
    const filePath = path.join(this.getExportDirectory(options), fileName);

    await fs.writeFile(filePath, content, 'utf8');
    const stats = await fs.stat(filePath);

    return {
      filePath,
      fileName,
      size: stats.size,
      downloadUrl: this.generateDownloadUrl(fileName, options)
    };
  }

  /**
   * Get export directory
   */
  getExportDirectory(options = {}) {
    const baseDir = options.destination || process.env.EXPORT_PATH || './exports';
    
    // Create directory if it doesn't exist
    require('fs').mkdirSync(baseDir, { recursive: true });
    
    return baseDir;
  }

  /**
   * Generate download URL
   */
  generateDownloadUrl(fileName, options = {}) {
    const baseUrl = options.baseUrl || process.env.BASE_URL || 'http://localhost:3001';
    return `${baseUrl}/api/exports/download/${fileName}`;
  }

  /**
   * Check if format is supported
   */
  isFormatSupported(format) {
    const supportedFormats = [
      'txt', 'json', 'csv', 'xml', 'pdf', 'docx', 'srt', 'vtt', 'html', 'markdown', 'md'
    ];
    return supportedFormats.includes(format.toLowerCase()) || this.customFormats.has(format);
  }

  /**
   * Helper methods for content generation
   */
  generateBasicTextContent(data) {
    let content = `Hebrew Transcription Report\n`;
    content += `${'='.repeat(40)}\n\n`;
    content += `File: ${data.originalFilename}\n`;
    content += `Language: ${data.language}\n`;
    content += `Confidence: ${Math.round((data.confidence || 0) * 100)}%\n`;
    content += `Duration: ${this.formatDuration(data.duration)}\n`;
    content += `Created: ${moment(data.createdAt).format('YYYY-MM-DD HH:mm:ss')}\n\n`;
    content += `Transcription:\n`;
    content += `${'-'.repeat(20)}\n`;
    content += `${data.transcriptionText || 'No transcription available'}\n`;
    return content;
  }

  generateDetailedTextContent(data) {
    let content = this.generateBasicTextContent(data);
    
    if (data.speakerLabels && data.speakerLabels.length > 0) {
      content += `\n\nSpeaker Segments:\n`;
      content += `${'-'.repeat(20)}\n`;
      data.speakerLabels.forEach(segment => {
        content += `[${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}] ${segment.speaker}: ${segment.text}\n`;
      });
    }

    if (data.lowConfidenceWords && data.lowConfidenceWords.length > 0) {
      content += `\n\nLow Confidence Words:\n`;
      content += `${'-'.repeat(20)}\n`;
      data.lowConfidenceWords.forEach(word => {
        content += `${word.word} (${Math.round(word.confidence * 100)}%)\n`;
      });
    }

    return content;
  }

  generateSpeakerBasedTextContent(data) {
    if (!data.speakerLabels || data.speakerLabels.length === 0) {
      return this.generateBasicTextContent(data);
    }

    let content = `Hebrew Transcription Report - Speaker View\n`;
    content += `${'='.repeat(50)}\n\n`;
    content += `File: ${data.originalFilename}\n`;
    content += `Speakers: ${data.speakerCount}\n`;
    content += `Duration: ${this.formatDuration(data.duration)}\n\n`;

    data.speakerLabels.forEach(segment => {
      content += `${segment.speaker} [${this.formatTime(segment.start)}]: ${segment.text}\n`;
    });

    return content;
  }

  /**
   * Helper methods for formatting
   */
  formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  formatSrtTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const milliseconds = Math.floor((remainingSeconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${Math.floor(remainingSeconds).toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
  }

  formatVttTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const milliseconds = Math.floor((remainingSeconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${Math.floor(remainingSeconds).toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  /**
   * Hebrew-specific helper methods
   */
  countHebrewCharacters(text) {
    if (!text) return 0;
    const hebrewRegex = /[\u0590-\u05FF]/g;
    const matches = text.match(hebrewRegex);
    return matches ? matches.length : 0;
  }

  countHebrewWords(text) {
    if (!text) return 0;
    const hebrewWords = text.split(/\s+/).filter(word => /[\u0590-\u05FF]/.test(word));
    return hebrewWords.length;
  }

  countHebrewSentences(text) {
    if (!text) return 0;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.length;
  }

  /**
   * Quality score calculation
   */
  calculateQualityScore(transcription) {
    let score = 0;
    
    // Base confidence score (0-40 points)
    if (transcription.confidence) {
      score += transcription.confidence * 40;
    }
    
    // Duration factor (0-20 points)
    if (transcription.duration) {
      const durationScore = Math.min(transcription.duration / 600, 1) * 20; // Up to 10 minutes
      score += durationScore;
    }
    
    // Low confidence words penalty (0-20 points deduction)
    if (transcription.lowConfidenceWords && transcription.lowConfidenceWords.length > 0) {
      const totalWords = transcription.transcriptionText ? transcription.transcriptionText.split(/\s+/).length : 0;
      const lowConfidenceRatio = transcription.lowConfidenceWords.length / totalWords;
      score -= lowConfidenceRatio * 20;
    }
    
    // Speaker diarization bonus (0-20 points)
    if (transcription.speakerLabels && transcription.speakerLabels.length > 0) {
      score += 20;
    }
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Filter fields for export
   */
  filterFields(data, fields) {
    const filtered = {};
    fields.forEach(field => {
      if (data.hasOwnProperty(field)) {
        filtered[field] = data[field];
      }
    });
    return filtered;
  }

  /**
   * Apply export template
   */
  async applyTemplate(template, data) {
    // Template processing logic
    return {
      templateName: template.name,
      appliedAt: new Date().toISOString(),
      customizations: template.customizations || {}
    };
  }

  /**
   * Load built-in export templates
   */
  loadBuiltInTemplates() {
    const templates = {
      'hebrew-liturgical': {
        name: 'Hebrew Liturgical',
        description: 'Template optimized for Hebrew liturgical content',
        customizations: {
          includeHebrew: true,
          rightToLeft: true,
          includeTimestamps: false,
          speakerLabels: false
        }
      },
      'meeting-minutes': {
        name: 'Meeting Minutes',
        description: 'Template for meeting transcriptions with speaker identification',
        customizations: {
          includeTimestamps: true,
          speakerLabels: true,
          confidenceThreshold: 0.8,
          formatSpeakers: true
        }
      },
      'educational': {
        name: 'Educational Content',
        description: 'Template for educational content transcriptions',
        customizations: {
          includeQuestions: true,
          chapterBreaks: true,
          keywordHighlighting: true
        }
      }
    };

    for (const [key, template] of Object.entries(templates)) {
      this.exportTemplates.set(key, template);
    }

    logger.info(`Loaded ${this.exportTemplates.size} export templates`);
  }

  /**
   * Register custom export format
   */
  registerCustomFormat(name, definition) {
    this.customFormats.set(name, definition);
    logger.info(`Registered custom export format: ${name}`);
  }

  /**
   * Get available export formats
   */
  getAvailableFormats() {
    const builtInFormats = [
      { name: 'txt', description: 'Plain Text' },
      { name: 'json', description: 'JSON Data' },
      { name: 'csv', description: 'Comma Separated Values' },
      { name: 'xml', description: 'XML Document' },
      { name: 'pdf', description: 'PDF Document' },
      { name: 'docx', description: 'Microsoft Word Document' },
      { name: 'srt', description: 'SubRip Subtitles' },
      { name: 'vtt', description: 'WebVTT Subtitles' },
      { name: 'html', description: 'HTML Document' },
      { name: 'markdown', description: 'Markdown Document' }
    ];

    const customFormats = Array.from(this.customFormats.keys()).map(name => ({
      name,
      description: this.customFormats.get(name).description || 'Custom Format'
    }));

    return [...builtInFormats, ...customFormats];
  }

  /**
   * Get available export templates
   */
  getAvailableTemplates() {
    const templates = {};
    for (const [key, template] of this.exportTemplates.entries()) {
      templates[key] = template;
    }
    return templates;
  }
}

module.exports = new ExportService();