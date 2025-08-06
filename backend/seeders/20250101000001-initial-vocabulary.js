'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { v4: uuidv4 } = require('uuid');
    const now = new Date();

    // Initial Hebrew vocabulary words for transcription
    const vocabularyWords = [
      // Halachic terms
      { word: 'שבת', category: 'halachic', pronunciation: 'Shabbat' },
      { word: 'כשרות', category: 'halachic', pronunciation: 'Kashrut' },
      { word: 'טהרה', category: 'halachic', pronunciation: 'Tahara' },
      { word: 'נידה', category: 'halachic', pronunciation: 'Niddah' },
      { word: 'הלכה', category: 'halachic', pronunciation: 'Halacha' },
      { word: 'מצוה', category: 'halachic', pronunciation: 'Mitzvah' },
      { word: 'תפילה', category: 'halachic', pronunciation: 'Tefillah' },
      { word: 'תפילין', category: 'halachic', pronunciation: 'Tefillin' },
      { word: 'מזוזה', category: 'halachic', pronunciation: 'Mezuzah' },
      { word: 'צדקה', category: 'halachic', pronunciation: 'Tzedaka' },
      { word: 'שמיטה', category: 'halachic', pronunciation: 'Shmita' },
      { word: 'יובל', category: 'halachic', pronunciation: 'Yovel' },

      // Chassidic concepts
      { word: 'צדיק', category: 'chassidic', pronunciation: 'Tzaddik' },
      { word: 'רבי', category: 'chassidic', pronunciation: 'Rebbe' },
      { word: 'חסידות', category: 'chassidic', pronunciation: 'Chassidut' },
      { word: 'תשובה', category: 'chassidic', pronunciation: 'Teshuvah' },
      { word: 'דביקות', category: 'chassidic', pronunciation: 'Devekut' },
      { word: 'ציון', category: 'chassidic', pronunciation: 'Tzion' },
      { word: 'נשמה', category: 'chassidic', pronunciation: 'Neshama' },
      { word: 'גילוי', category: 'chassidic', pronunciation: 'Gilui' },
      { word: 'נסתר', category: 'chassidic', pronunciation: 'Nistar' },
      { word: 'קדושה', category: 'chassidic', pronunciation: 'Kedusha' },
      { word: 'אהבה', category: 'chassidic', pronunciation: 'Ahava' },
      { word: 'יראה', category: 'chassidic', pronunciation: 'Yirah' },

      // Calendar terms
      { word: 'ראש השנה', category: 'calendar', pronunciation: 'Rosh Hashanah' },
      { word: 'יום כיפור', category: 'calendar', pronunciation: 'Yom Kippur' },
      { word: 'פסח', category: 'calendar', pronunciation: 'Pesach' },
      { word: 'סוכות', category: 'calendar', pronunciation: 'Sukkot' },
      { word: 'חנוכה', category: 'calendar', pronunciation: 'Chanukah' },
      { word: 'פורים', category: 'calendar', pronunciation: 'Purim' },
      { word: 'לג בעומר', category: 'calendar', pronunciation: 'Lag BaOmer' },
      { word: 'ר"ח', category: 'calendar', pronunciation: 'Rosh Chodesh' },
      { word: 'עמר', category: 'calendar', pronunciation: 'Omer' },
      { word: 'ספירה', category: 'calendar', pronunciation: 'Sefirah' },
      { word: 'חול המועד', category: 'calendar', pronunciation: 'Chol HaMoed' },

      // Common Yiddish/Hebrew expressions
      { word: 'גוט שבת', category: 'yiddish', pronunciation: 'Gut Shabbos' },
      { word: 'שבת שלום', category: 'general', pronunciation: 'Shabbat Shalom' },
      { word: 'מזל טוב', category: 'general', pronunciation: 'Mazel Tov' },
      { word: 'ברוך השם', category: 'general', pronunciation: 'Baruch Hashem' },
      { word: 'בעזרת השם', category: 'general', pronunciation: 'BeEzrat Hashem' },

      // Places
      { word: 'ירושלים', category: 'places', pronunciation: 'Yerushalayim' },
      { word: 'בית המקדש', category: 'places', pronunciation: 'Beit HaMikdash' },
      { word: 'כותל', category: 'places', pronunciation: 'Kotel' },
      { word: 'ברוקלין', category: 'places', pronunciation: 'Brooklyn' },
      { word: 'מנהטן', category: 'places', pronunciation: 'Manhattan' },

      // Common names
      { word: 'משה', category: 'names', pronunciation: 'Moshe' },
      { word: 'אברהם', category: 'names', pronunciation: 'Avraham' },
      { word: 'יצחק', category: 'names', pronunciation: 'Yitzchak' },
      { word: 'יעקב', category: 'names', pronunciation: 'Yaakov' },
      { word: 'דוד', category: 'names', pronunciation: 'David' },
      { word: 'שלמה', category: 'names', pronunciation: 'Shlomo' }
    ];

    // Create vocabulary records
    const vocabularyRecords = vocabularyWords.map(word => ({
      id: uuidv4(),
      userId: null, // Global vocabulary
      word: word.word,
      pronunciation: word.pronunciation,
      category: word.category,
      frequency: 1,
      isGlobal: true,
      isActive: true,
      addedBy: null,
      approvedBy: null,
      approvedAt: now,
      metadata: JSON.stringify({}),
      createdAt: now,
      updatedAt: now
    }));

    await queryInterface.bulkInsert('CustomVocabularies', vocabularyRecords);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('CustomVocabularies', {
      isGlobal: true
    });
  }
};