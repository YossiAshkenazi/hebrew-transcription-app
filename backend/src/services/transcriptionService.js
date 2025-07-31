const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { CustomVocabulary } = require('../models');
const logger = require('../utils/logger');

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

class TranscriptionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.hebrewTerminology = [
      // Halachic terms
      'שבת', 'כשרות', 'טהרה', 'נידה', 'הלכה', 'מצוה', 'תפילה',
      'תפילין', 'מזוזה', 'צדקה', 'שמיטה', 'יובל', 'פסח', 'סוכות',
      
      // Chassidic concepts
      'צדיק', 'רבי', 'חסידות', 'תשובה', 'דביקות', 'ציון', 'נשמה',
      'גילוי', 'נסתר', 'קדושה', 'אהבה', 'יראה',
      
      // Calendar terms
      'ראש השנה', 'יום כיפור', 'חנוכה', 'פורים', 'לג בעומר',
      'ר"ח', 'עמר', 'ספירה', 'חול המועד',
      
      // Common Yiddish in Hebrew context
      'גוט שבת', 'שבת שלום', 'מזל טוב', 'ברוך השם', 'בעזרת השם'
    ];
  }

  async preprocessAudio(inputPath, outputPath) {
    try {
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .toFormat('mp3')
          .audioChannels(1) // Convert to mono
          .audioFrequency(16000) // 16kHz sample rate
          .audioCodec('mp3')
          .on('end', () => {
            logger.info(`Audio preprocessing completed: ${outputPath}`);
            resolve(outputPath);
          })
          .on('error', (err) => {
            logger.error('Audio preprocessing failed:', err);
            reject(err);
          })
          .save(outputPath);
      });
    } catch (error) {
      logger.error('Audio preprocessing error:', error);
      throw new Error(`Audio preprocessing failed: ${error.message}`);
    }
  }

  async getAudioDuration(filePath) {
    try {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            reject(err);
          } else {
            const duration = metadata.format.duration;
            resolve(duration);
          }
        });
      });
    } catch (error) {
      logger.error('Error getting audio duration:', error);
      throw error;
    }
  }

  async buildCustomVocabulary(userId = null) {
    try {
      const vocabularyWords = await CustomVocabulary.getCombinedVocabulary(userId);
      const customTerms = vocabularyWords.map(item => item.word);
      
      // Combine with default Hebrew terminology
      return [...this.hebrewTerminology, ...customTerms];
    } catch (error) {
      logger.error('Error building custom vocabulary:', error);
      return this.hebrewTerminology;
    }
  }

  async transcribeAudio(filePath, options = {}) {
    const startTime = Date.now();
    
    try {
      // Get audio duration for validation
      const duration = await this.getAudioDuration(filePath);
      const maxDuration = (parseInt(process.env.MAX_AUDIO_DURATION_MINUTES) || 180) * 60;
      
      if (duration > maxDuration) {
        throw new Error(`Audio file too long. Maximum duration is ${maxDuration / 60} minutes.`);
      }

      // Preprocess audio for better recognition
      const tempDir = process.env.TEMP_PATH || './temp';
      const preprocessedPath = path.join(tempDir, `preprocessed_${Date.now()}.mp3`);
      
      await this.preprocessAudio(filePath, preprocessedPath);

      // Build custom vocabulary for this user
      const vocabulary = await this.buildCustomVocabulary(options.userId);
      
      // Create the transcription request
      const transcriptionOptions = {
        file: await fs.readFile(preprocessedPath),
        model: 'whisper-1',
        language: 'he', // Hebrew
        response_format: 'verbose_json',
        temperature: 0.2, // Lower temperature for more consistent results
        prompt: this.buildPrompt(vocabulary)
      };

      logger.info('Starting transcription with OpenAI Whisper...');
      const response = await this.openai.audio.transcriptions.create(transcriptionOptions);

      // Clean up preprocessed file
      try {
        await fs.unlink(preprocessedPath);
      } catch (cleanupError) {
        logger.warn('Failed to cleanup preprocessed file:', cleanupError);
      }

      const processingTime = Date.now() - startTime;
      
      // Process the response
      const result = {
        text: response.text,
        duration: duration,
        language: response.language,
        segments: response.segments || [],
        processingTime: processingTime,
        confidence: this.calculateAverageConfidence(response.segments || []),
        lowConfidenceWords: this.extractLowConfidenceWords(response.segments || []),
        speakerLabels: this.extractSpeakerInfo(response.segments || []),
        metadata: {
          model: 'whisper-1',
          customVocabularyCount: vocabulary.length,
          timestamp: new Date().toISOString()
        }
      };

      logger.info(`Transcription completed in ${processingTime}ms`);
      return result;

    } catch (error) {
      logger.error('Transcription failed:', error);
      
      // Handle specific OpenAI errors
      if (error.code === 'insufficient_quota') {
        throw new Error('Transcription service quota exceeded. Please try again later.');
      }
      
      if (error.code === 'invalid_request_error') {
        throw new Error('Invalid audio file format or content.');
      }
      
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  buildPrompt(vocabulary) {
    // Create a prompt that includes Hebrew terminology to improve recognition
    const vocabularyText = vocabulary.slice(0, 50).join(', '); // Limit to first 50 terms
    
    return `This is a Hebrew conversation that may contain religious and cultural terms including: ${vocabularyText}. Please transcribe accurately with proper Hebrew spelling and diacritics where appropriate.`;
  }

  calculateAverageConfidence(segments) {
    if (!segments || segments.length === 0) return null;
    
    const totalConfidence = segments.reduce((sum, segment) => {
      return sum + (segment.avg_logprob || 0);
    }, 0);
    
    // Convert log probability to confidence score (0-1)
    const avgLogProb = totalConfidence / segments.length;
    return Math.exp(avgLogProb);
  }

  extractLowConfidenceWords(segments, threshold = 0.5) {
    const lowConfidenceWords = [];
    
    segments.forEach(segment => {
      if (segment.words) {
        segment.words.forEach(word => {
          const confidence = Math.exp(word.probability || 0);
          if (confidence < threshold) {
            lowConfidenceWords.push({
              word: word.word,
              confidence: confidence,
              start: word.start,
              end: word.end
            });
          }
        });
      }
    });
    
    return lowConfidenceWords;
  }

  extractSpeakerInfo(segments) {
    // Basic speaker separation based on silence gaps
    // This is a simplified implementation - for better results, use specialized diarization
    const speakers = [];
    let currentSpeaker = 1;
    let lastEndTime = 0;
    
    segments.forEach((segment, index) => {
      const silenceGap = segment.start - lastEndTime;
      
      // If there's a significant gap (> 2 seconds), assume new speaker
      if (silenceGap > 2 && index > 0) {
        currentSpeaker = currentSpeaker === 1 ? 2 : 1;
      }
      
      speakers.push({
        speaker: `Speaker ${currentSpeaker}`,
        start: segment.start,
        end: segment.end,
        text: segment.text
      });
      
      lastEndTime = segment.end;
    });
    
    return speakers;
  }

  async getTranscriptionQuote(duration, options = {}) {
    // Estimate cost and processing time
    const costPerMinute = 0.006; // OpenAI Whisper pricing
    const processingMultiplier = 2.5; // Estimate 2.5x real-time processing
    
    const durationMinutes = Math.ceil(duration / 60);
    const estimatedCost = durationMinutes * costPerMinute;
    const estimatedTime = duration * processingMultiplier;
    
    return {
      estimatedCost: parseFloat(estimatedCost.toFixed(4)),
      estimatedTimeSeconds: Math.ceil(estimatedTime),
      durationMinutes: durationMinutes,
      currency: 'USD'
    };
  }
}

module.exports = new TranscriptionService();
