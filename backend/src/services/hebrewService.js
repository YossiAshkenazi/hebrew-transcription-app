const logger = require('../utils/logger');
const moment = require('moment-timezone');
const HDate = require('@hebcal/hdate');
const { Zmanim } = require('@hebcal/zmanim');

/**
 * Hebrew-Specific Features Service
 * Provides liturgical calendar, religious content detection, and Hebrew text processing
 */
class HebrewService {
  constructor() {
    this.liturgicalPatterns = new Map();
    this.religiousTerms = new Map();
    this.hebrewCalendar = null;
    this.prayerSchedules = new Map();
    this.holidaySchedules = new Map();
    
    this.initializeLiturgicalPatterns();
    this.initializeReligiousTerms();
    this.initializeHebrewCalendar();
  }

  /**
   * Initialize liturgical patterns for content detection
   */
  initializeLiturgicalPatterns() {
    const patterns = {
      // Prayer patterns
      prayers: {
        'שחרית': {
          category: 'morning_prayer',
          confidence: 0.9,
          keywords: ['שחרית', 'תפילת שחר', 'ברכות השחר', 'פסוקי דזמרה', 'שמע', 'שמונה עשרה']
        },
        'מנחה': {
          category: 'afternoon_prayer',
          confidence: 0.9,
          keywords: ['מנחה', 'תפילת מנחה', 'אשרי', 'חצי קדיש']
        },
        'מעריב': {
          category: 'evening_prayer',
          confidence: 0.9,
          keywords: ['מעריב', 'תפילת מעריב', 'ברכו', 'שמע ישראל', 'והיה אם שמוע']
        },
        'קבלת שבת': {
          category: 'sabbath_welcoming',
          confidence: 0.95,
          keywords: ['קבלת שבת', 'לכה דודי', 'מזמור שיר ליום השבת', 'לכו נרננה']
        },
        'הבדלה': {
          category: 'havdalah',
          confidence: 0.95,
          keywords: ['הבדלה', 'המבדיל בין קודש לחול', 'הנה אל ישועתי', 'ויתן לך']
        }
      },

      // Torah study patterns
      torah_study: {
        'שיעור': {
          category: 'torah_lesson',
          confidence: 0.8,
          keywords: ['שיעור', 'לימוד', 'הרצאה', 'דרשה', 'פרשת השבוע', 'גמרא', 'משנה', 'תנ"ך']
        },
        'חבורה': {
          category: 'study_group',
          confidence: 0.85,
          keywords: ['חבורה', 'חברותא', 'לימוד בחברותא', 'עיון', 'בקיאות']
        }
      },

      // Liturgical music patterns
      liturgical_music: {
        'ניגון': {
          category: 'melody',
          confidence: 0.8,
          keywords: ['ניגון', 'מנגינה', 'זמירות', 'פיוט', 'קינה', 'סליחות']
        },
        'קריאת התורה': {
          category: 'torah_reading',
          confidence: 0.95,
          keywords: ['קריאת התורה', 'עליה לתורה', 'ברכת התורה', 'הפטרה', 'מפטיר']
        }
      },

      // Holiday and festival patterns
      holidays: {
        'ראש השנה': {
          category: 'rosh_hashanah',
          confidence: 0.95,
          keywords: ['ראש השנה', 'יום הדין', 'תקיעת שופר', 'מלכויות', 'זכרונות', 'שופרות']
        },
        'יום כיפור': {
          category: 'yom_kippur',
          confidence: 0.95,
          keywords: ['יום כיפור', 'יום הכיפורים', 'כל נדרי', 'נעילה', 'וידוי', 'סליחות']
        },
        'סוכות': {
          category: 'sukkot',
          confidence: 0.9,
          keywords: ['סוכות', 'חג הסוכות', 'ארבעת המינים', 'לולב', 'אתרוג', 'הושענא']
        },
        'פסח': {
          category: 'passover',
          confidence: 0.95,
          keywords: ['פסח', 'חג הפסח', 'הגדה', 'סדר פסח', 'מצה', 'מרור', 'חרוסת']
        },
        'שבועות': {
          category: 'shavuot',
          confidence: 0.9,
          keywords: ['שבועות', 'חג השבועות', 'זמן מתן תורתנו', 'עצרת', 'בכורים']
        }
      },

      // Life cycle events
      lifecycle: {
        'ברית מילה': {
          category: 'brit_milah',
          confidence: 0.95,
          keywords: ['ברית מילה', 'ברית', 'מוהל', 'סנדק', 'זכר לברית אברהם אבינו']
        },
        'בר מצווה': {
          category: 'bar_mitzvah',
          confidence: 0.9,
          keywords: ['בר מצווה', 'בת מצווה', 'עליה לתורה', 'דרשה', 'תפילין']
        },
        'חתונה': {
          category: 'wedding',
          confidence: 0.9,
          keywords: ['חתונה', 'נישואין', 'קידושין', 'חופה', 'כתובה', 'שבע ברכות', 'שבירת הכוס']
        },
        'אבלות': {
          category: 'mourning',
          confidence: 0.85,
          keywords: ['אבלות', 'שבעה', 'שלושים', 'קדיש', 'הספד', 'לוויה', 'זכר צדיק לברכה']
        }
      }
    };

    for (const [categoryGroup, categories] of Object.entries(patterns)) {
      for (const [patternName, pattern] of Object.entries(categories)) {
        this.liturgicalPatterns.set(`${categoryGroup}:${patternName}`, pattern);
      }
    }

    logger.info(`Loaded ${this.liturgicalPatterns.size} liturgical patterns`);
  }

  /**
   * Initialize religious terms dictionary
   */
  initializeReligiousTerms() {
    const terms = {
      // Divine names and references
      divine: [
        'אלוהים', 'אלוקים', 'אלהים', 'ה\'', 'השם', 'הקדוש ברוך הוא', 'הבורא', 'עליון',
        'שדי', 'צבאות', 'אדני', 'יהוה', 'אל', 'עולם', 'מלך העולם'
      ],

      // Religious figures
      figures: [
        'אברהם', 'יצחק', 'יעקב', 'משה רבנו', 'אהרן', 'דוד המלך', 'שלמה',
        'רבי', 'הרב', 'גאון', 'צדיק', 'רש"י', 'רמב"ם', 'רמב"ן'
      ],

      // Religious concepts
      concepts: [
        'תורה', 'מצוה', 'מצוות', 'הלכה', 'אגדה', 'כשרות', 'שבת', 'טהרה',
        'טומאה', 'קדושה', 'ברכה', 'תשובה', 'חסד', 'צדקה', 'גמילות חסדים'
      ],

      // Places and objects
      places_objects: [
        'בית הכנסת', 'בית המקדש', 'ירושלים', 'ציון', 'ארץ ישראל', 'תפילין',
        'מזוזה', 'טלית', 'כיפה', 'לולב', 'אתרוג', 'שופר', 'מצה', 'תורה'
      ],

      // Time and calendar
      time_calendar: [
        'שבת', 'יום טוב', 'חול המועד', 'ראש חודש', 'עיום', 'לילה', 'בוקר',
        'ערב', 'צהריים', 'זמנים', 'תחילת השבת', 'מוצאי שבת'
      ]
    };

    for (const [category, termList] of Object.entries(terms)) {
      for (const term of termList) {
        this.religiousTerms.set(term, {
          category,
          weight: this.calculateTermWeight(term, category)
        });
      }
    }

    logger.info(`Loaded ${this.religiousTerms.size} religious terms`);
  }

  /**
   * Initialize Hebrew calendar system
   */
  initializeHebrewCalendar() {
    this.hebrewCalendar = {
      getCurrentHebrewDate: () => {
        return new HDate();
      },
      
      getHebrewDateString: (date) => {
        const hdate = date ? new HDate(date) : new HDate();
        return hdate.toString('h');
      },

      isJewishHoliday: (date) => {
        const hdate = date ? new HDate(date) : new HDate();
        return hdate.getDesc() !== '';
      },

      getJewishHolidayName: (date) => {
        const hdate = date ? new HDate(date) : new HDate();
        return hdate.getDesc();
      },

      isShabbat: (date) => {
        const targetDate = date ? new Date(date) : new Date();
        return targetDate.getDay() === 6; // Saturday
      },

      getNextShabbat: () => {
        const now = new Date();
        const daysUntilSaturday = (6 - now.getDay()) % 7;
        const nextSaturday = new Date(now);
        nextSaturday.setDate(now.getDate() + daysUntilSaturday);
        return nextSaturday;
      },

      getPrayerTimes: (date, location) => {
        try {
          const targetDate = date ? new Date(date) : new Date();
          const zmanim = new Zmanim(targetDate, location.latitude, location.longitude);
          
          return {
            alotHaShachar: zmanim.alotHaShachar(),
            misheyakir: zmanim.misheyakir(),
            sunrise: zmanim.sunrise(),
            sofZmanShma: zmanim.sofZmanShma(),
            sofZmanTfilla: zmanim.sofZmanTfilla(),
            chatzot: zmanim.chatzot(),
            minchaGedola: zmanim.minchaGedola(),
            minchaKetana: zmanim.minchaKetana(),
            plagMincha: zmanim.plagMincha(),
            sunset: zmanim.sunset(),
            tzeit: zmanim.tzeit(),
            tzeitLechumra: zmanim.tzeitLechumra()
          };
        } catch (error) {
          logger.error('Failed to calculate prayer times:', error);
          return null;
        }
      }
    };

    logger.info('Hebrew calendar system initialized');
  }

  /**
   * Detect religious content in transcription
   */
  async detectReligiousContent(transcriptionText, options = {}) {
    try {
      const results = {
        isReligious: false,
        confidence: 0,
        categories: [],
        patterns: [],
        religiousTerms: [],
        liturgicalElements: [],
        hebrewAnalysis: {},
        recommendations: []
      };

      if (!transcriptionText || transcriptionText.trim().length === 0) {
        return results;
      }

      // Analyze Hebrew text characteristics
      results.hebrewAnalysis = this.analyzeHebrewText(transcriptionText);

      // Detect liturgical patterns
      const liturgicalDetection = this.detectLiturgicalPatterns(transcriptionText);
      results.patterns = liturgicalDetection.patterns;
      results.liturgicalElements = liturgicalDetection.elements;

      // Identify religious terms
      const termAnalysis = this.identifyReligiousTerms(transcriptionText);
      results.religiousTerms = termAnalysis.terms;

      // Calculate overall confidence and categories
      const confidence = this.calculateReligiousConfidence(liturgicalDetection, termAnalysis, results.hebrewAnalysis);
      results.confidence = confidence.overall;
      results.categories = confidence.categories;
      results.isReligious = confidence.overall > 0.5;

      // Generate recommendations
      results.recommendations = this.generateContentRecommendations(results);

      // Check for liturgical calendar context
      const calendarContext = this.getCalendarContext();
      if (calendarContext.isRelevant) {
        results.calendarContext = calendarContext;
      }

      logger.debug('Religious content detection completed', {
        confidence: results.confidence,
        categories: results.categories.length,
        patterns: results.patterns.length
      });

      return results;

    } catch (error) {
      logger.error('Religious content detection failed:', error);
      throw error;
    }
  }

  /**
   * Analyze Hebrew text characteristics
   */
  analyzeHebrewText(text) {
    const analysis = {
      totalCharacters: text.length,
      hebrewCharacters: 0,
      hebrewWords: 0,
      hebrewSentences: 0,
      hebrewPercentage: 0,
      textDirection: 'ltr',
      hasDiacritics: false,
      hasAramaic: false,
      readingComplexity: 'basic'
    };

    // Count Hebrew characters
    const hebrewRegex = /[\u0590-\u05FF]/g;
    const hebrewMatches = text.match(hebrewRegex);
    analysis.hebrewCharacters = hebrewMatches ? hebrewMatches.length : 0;
    analysis.hebrewPercentage = (analysis.hebrewCharacters / analysis.totalCharacters) * 100;

    // Count Hebrew words
    const words = text.split(/\s+/);
    analysis.hebrewWords = words.filter(word => /[\u0590-\u05FF]/.test(word)).length;

    // Count sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    analysis.hebrewSentences = sentences.filter(sentence => /[\u0590-\u05FF]/.test(sentence)).length;

    // Determine text direction
    if (analysis.hebrewPercentage > 50) {
      analysis.textDirection = 'rtl';
    }

    // Check for diacritics (nikud)
    const diacriticsRegex = /[\u05B0-\u05C7]/g;
    analysis.hasDiacritics = diacriticsRegex.test(text);

    // Check for Aramaic patterns (simplified)
    const aramaicPatterns = ['די', 'דא', 'הוא', 'היא', 'אמר', 'תנא', 'אמרי'];
    analysis.hasAramaic = aramaicPatterns.some(pattern => text.includes(pattern));

    // Assess reading complexity
    if (analysis.hasDiacritics || analysis.hasAramaic) {
      analysis.readingComplexity = 'advanced';
    } else if (analysis.hebrewPercentage > 80) {
      analysis.readingComplexity = 'intermediate';
    }

    return analysis;
  }

  /**
   * Detect liturgical patterns in text
   */
  detectLiturgicalPatterns(text) {
    const results = {
      patterns: [],
      elements: [],
      confidence: 0
    };

    for (const [patternKey, pattern] of this.liturgicalPatterns.entries()) {
      let matches = 0;
      let matchedKeywords = [];

      for (const keyword of pattern.keywords) {
        if (text.includes(keyword)) {
          matches++;
          matchedKeywords.push(keyword);
        }
      }

      if (matches > 0) {
        const patternConfidence = (matches / pattern.keywords.length) * pattern.confidence;
        
        results.patterns.push({
          pattern: patternKey,
          category: pattern.category,
          confidence: patternConfidence,
          matches: matches,
          totalKeywords: pattern.keywords.length,
          matchedKeywords: matchedKeywords
        });

        results.elements.push(...matchedKeywords);
      }
    }

    // Calculate overall liturgical confidence
    if (results.patterns.length > 0) {
      results.confidence = results.patterns.reduce((sum, p) => sum + p.confidence, 0) / results.patterns.length;
    }

    // Sort patterns by confidence
    results.patterns.sort((a, b) => b.confidence - a.confidence);

    return results;
  }

  /**
   * Identify religious terms in text
   */
  identifyReligiousTerms(text) {
    const results = {
      terms: [],
      categories: {},
      totalWeight: 0
    };

    for (const [term, termData] of this.religiousTerms.entries()) {
      const regex = new RegExp(`\\b${term}\\b`, 'g');
      const matches = text.match(regex);
      
      if (matches) {
        const count = matches.length;
        const weight = termData.weight * count;
        
        results.terms.push({
          term: term,
          category: termData.category,
          count: count,
          weight: weight
        });

        if (!results.categories[termData.category]) {
          results.categories[termData.category] = 0;
        }
        results.categories[termData.category] += weight;
        results.totalWeight += weight;
      }
    }

    // Sort terms by weight
    results.terms.sort((a, b) => b.weight - a.weight);

    return results;
  }

  /**
   * Calculate religious content confidence
   */
  calculateReligiousConfidence(liturgicalDetection, termAnalysis, hebrewAnalysis) {
    const weights = {
      liturgical: 0.4,
      terms: 0.3,
      hebrew: 0.2,
      patterns: 0.1
    };

    let overallConfidence = 0;
    const categories = [];

    // Liturgical patterns contribution
    const liturgicalScore = Math.min(liturgicalDetection.confidence, 1);
    overallConfidence += liturgicalScore * weights.liturgical;

    if (liturgicalScore > 0.3) {
      categories.push({
        type: 'liturgical',
        confidence: liturgicalScore,
        primaryPatterns: liturgicalDetection.patterns.slice(0, 3).map(p => p.category)
      });
    }

    // Religious terms contribution
    const termsScore = Math.min(termAnalysis.totalWeight / 100, 1); // Normalize to 0-1
    overallConfidence += termsScore * weights.terms;

    if (termsScore > 0.2) {
      categories.push({
        type: 'religious_terminology',
        confidence: termsScore,
        primaryCategories: Object.keys(termAnalysis.categories).slice(0, 3)
      });
    }

    // Hebrew text characteristics contribution
    const hebrewScore = hebrewAnalysis.hebrewPercentage / 100;
    overallConfidence += hebrewScore * weights.hebrew;

    if (hebrewScore > 0.5) {
      categories.push({
        type: 'hebrew_text',
        confidence: hebrewScore,
        characteristics: {
          percentage: hebrewAnalysis.hebrewPercentage,
          complexity: hebrewAnalysis.readingComplexity,
          direction: hebrewAnalysis.textDirection
        }
      });
    }

    // Additional patterns bonus
    if (hebrewAnalysis.hasDiacritics) {
      overallConfidence += 0.1 * weights.patterns;
      categories.push({
        type: 'liturgical_text',
        confidence: 0.8,
        features: ['diacritics']
      });
    }

    if (hebrewAnalysis.hasAramaic) {
      overallConfidence += 0.15 * weights.patterns;
      categories.push({
        type: 'talmudic_text',
        confidence: 0.9,
        features: ['aramaic']
      });
    }

    return {
      overall: Math.min(overallConfidence, 1),
      categories: categories
    };
  }

  /**
   * Generate content recommendations
   */
  generateContentRecommendations(analysisResults) {
    const recommendations = [];

    if (analysisResults.isReligious) {
      recommendations.push({
        type: 'categorization',
        priority: 'high',
        suggestion: 'Categorize as religious/liturgical content',
        reason: `High religious confidence: ${Math.round(analysisResults.confidence * 100)}%`
      });

      // Calendar-based recommendations
      const calendarContext = this.getCalendarContext();
      if (calendarContext.isRelevant) {
        recommendations.push({
          type: 'calendar_context',
          priority: 'medium',
          suggestion: `Associate with ${calendarContext.currentPeriod}`,
          reason: calendarContext.description
        });
      }

      // Export format recommendations
      if (analysisResults.hebrewAnalysis.textDirection === 'rtl') {
        recommendations.push({
          type: 'export_format',
          priority: 'medium',
          suggestion: 'Use RTL-compatible export formats (PDF, HTML with RTL support)',
          reason: 'Text contains significant Hebrew content requiring right-to-left formatting'
        });
      }

      // Custom vocabulary recommendations
      if (analysisResults.religiousTerms.length > 10) {
        recommendations.push({
          type: 'vocabulary',
          priority: 'medium',
          suggestion: 'Apply religious/liturgical custom vocabulary for improved accuracy',
          reason: `Detected ${analysisResults.religiousTerms.length} religious terms`
        });
      }

      // Processing recommendations
      if (analysisResults.liturgicalElements.length > 0) {
        recommendations.push({
          type: 'processing',
          priority: 'low',
          suggestion: 'Consider speaker diarization for liturgical roles (cantor, congregation, rabbi)',
          reason: 'Liturgical content often involves multiple speakers with specific roles'
        });
      }
    }

    return recommendations;
  }

  /**
   * Get current calendar context
   */
  getCalendarContext() {
    const now = new Date();
    const hdate = new HDate();
    
    const context = {
      isRelevant: false,
      currentPeriod: null,
      description: null,
      hebrewDate: hdate.toString('h'),
      gregorianDate: now.toISOString().split('T')[0]
    };

    // Check for current Jewish holiday
    const holidayName = hdate.getDesc();
    if (holidayName) {
      context.isRelevant = true;
      context.currentPeriod = holidayName;
      context.description = `Currently during ${holidayName}`;
      return context;
    }

    // Check if it's Shabbat
    if (this.hebrewCalendar.isShabbat(now)) {
      context.isRelevant = true;
      context.currentPeriod = 'Shabbat';
      context.description = 'Currently Shabbat';
      return context;
    }

    // Check for upcoming Shabbat
    const nextShabbat = this.hebrewCalendar.getNextShabbat();
    const daysToShabbat = Math.ceil((nextShabbat - now) / (1000 * 60 * 60 * 24));
    if (daysToShabbat <= 1) {
      context.isRelevant = true;
      context.currentPeriod = 'Pre-Shabbat';
      context.description = `Approaching Shabbat (${daysToShabbat} day${daysToShabbat !== 1 ? 's' : ''})`;
      return context;
    }

    // Check for special periods (simplified)
    const monthName = hdate.getMonthName();
    const dayOfMonth = hdate.getDate();
    
    // Elul (month of preparation for High Holidays)
    if (monthName === 'Elul') {
      context.isRelevant = true;
      context.currentPeriod = 'Elul';
      context.description = 'Month of Elul - preparation period for High Holidays';
      return context;
    }

    // Days of Awe (between Rosh Hashanah and Yom Kippur)
    if (monthName === 'Tishrei' && dayOfMonth >= 1 && dayOfMonth <= 10) {
      context.isRelevant = true;
      context.currentPeriod = 'Aseret Yemei Teshuva';
      context.description = 'Ten Days of Repentance (between Rosh Hashanah and Yom Kippur)';
      return context;
    }

    return context;
  }

  /**
   * Get liturgical schedule recommendations
   */
  getLiturgicalScheduleRecommendations(location = null) {
    const recommendations = {
      currentDate: new Date().toISOString(),
      hebrewDate: this.hebrewCalendar.getHebrewDateString(),
      isShabbat: this.hebrewCalendar.isShabbat(),
      upcomingEvents: [],
      prayerTimes: null,
      processingRecommendations: []
    };

    // Get prayer times if location provided
    if (location) {
      recommendations.prayerTimes = this.hebrewCalendar.getPrayerTimes(null, location);
    }

    // Get upcoming events for the next week
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date();
      checkDate.setDate(checkDate.getDate() + i);
      
      const hdate = new HDate(checkDate);
      const holidayName = hdate.getDesc();
      
      if (holidayName || checkDate.getDay() === 6) {
        recommendations.upcomingEvents.push({
          date: checkDate.toISOString().split('T')[0],
          hebrewDate: hdate.toString('h'),
          event: holidayName || 'Shabbat',
          type: holidayName ? 'holiday' : 'shabbat'
        });
      }
    }

    // Generate processing recommendations
    if (recommendations.isShabbat) {
      recommendations.processingRecommendations.push({
        type: 'scheduling',
        priority: 'medium',
        suggestion: 'Consider delayed processing for Shabbat-related content',
        reason: 'Current time is during Shabbat'
      });
    }

    if (recommendations.upcomingEvents.length > 0) {
      recommendations.processingRecommendations.push({
        type: 'prioritization',
        priority: 'low',
        suggestion: 'Prioritize processing of holiday-related content',
        reason: `Upcoming events: ${recommendations.upcomingEvents.map(e => e.event).join(', ')}`
      });
    }

    return recommendations;
  }

  /**
   * Calculate term weight based on category and frequency
   */
  calculateTermWeight(term, category) {
    const categoryWeights = {
      divine: 1.0,
      figures: 0.8,
      concepts: 0.9,
      places_objects: 0.7,
      time_calendar: 0.6
    };

    const baseWeight = categoryWeights[category] || 0.5;
    const lengthFactor = Math.min(term.length / 10, 1.2); // Longer terms slightly more weight
    
    return baseWeight * lengthFactor;
  }

  /**
   * Get Hebrew text processing recommendations
   */
  getHebrewProcessingRecommendations(transcription) {
    const recommendations = [];

    // Analyze Hebrew content
    const hebrewAnalysis = this.analyzeHebrewText(transcription.transcriptionText || '');
    
    if (hebrewAnalysis.hebrewPercentage > 70) {
      recommendations.push({
        type: 'language_model',
        priority: 'high',
        suggestion: 'Use Hebrew-optimized language model',
        details: {
          hebrewPercentage: hebrewAnalysis.hebrewPercentage,
          textDirection: hebrewAnalysis.textDirection
        }
      });
    }

    if (hebrewAnalysis.hasDiacritics) {
      recommendations.push({
        type: 'diacritics',
        priority: 'medium',
        suggestion: 'Enable diacritics-aware processing',
        details: {
          feature: 'nikud_support',
          benefit: 'Improved accuracy for vowelized Hebrew text'
        }
      });
    }

    if (hebrewAnalysis.hasAramaic) {
      recommendations.push({
        type: 'multilingual',
        priority: 'medium',
        suggestion: 'Enable Aramaic language support',
        details: {
          languages: ['hebrew', 'aramaic'],
          context: 'Talmudic or liturgical content detected'
        }
      });
    }

    return recommendations;
  }

  /**
   * Generate liturgical content summary
   */
  generateLiturgicalSummary(analysisResults) {
    const summary = {
      contentType: 'unknown',
      primaryCategory: null,
      confidence: analysisResults.confidence,
      keyElements: [],
      liturgicalPeriod: null,
      recommendations: []
    };

    if (analysisResults.isReligious) {
      // Determine primary content type
      if (analysisResults.categories.length > 0) {
        const primaryCategory = analysisResults.categories[0];
        summary.contentType = primaryCategory.type;
        summary.primaryCategory = primaryCategory;
      }

      // Extract key liturgical elements
      summary.keyElements = analysisResults.liturgicalElements.slice(0, 10);

      // Add calendar context
      const calendarContext = this.getCalendarContext();
      if (calendarContext.isRelevant) {
        summary.liturgicalPeriod = calendarContext.currentPeriod;
      }

      // Consolidate recommendations
      summary.recommendations = analysisResults.recommendations.filter(r => r.priority === 'high');
    }

    return summary;
  }
}

module.exports = new HebrewService();