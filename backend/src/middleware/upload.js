const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;

// Ensure upload directories exist
const createUploadDirs = async () => {
  const uploadPath = process.env.UPLOAD_PATH || './uploads';
  const tempPath = process.env.TEMP_PATH || './temp';
  
  try {
    await fs.mkdir(uploadPath, { recursive: true });
    await fs.mkdir(tempPath, { recursive: true });
  } catch (error) {
    console.error('Failed to create upload directories:', error);
  }
};

// Initialize upload directories
createUploadDirs();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempPath = process.env.TEMP_PATH || './temp';
    cb(null, tempPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${extension}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'audio/mpeg',      // MP3
    'audio/wav',       // WAV
    'audio/wave',      // WAV (alternative)
    'audio/x-wav',     // WAV (alternative)
    'audio/mp4',       // M4A
    'audio/m4a',       // M4A
    'audio/aac',       // AAC
    'audio/flac',      // FLAC
    'audio/x-flac'     // FLAC (alternative)
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(
      'Invalid file type. Only MP3, WAV, M4A, AAC, and FLAC files are allowed.'
    ), false);
  }
};

// Configure upload
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 100) * 1024 * 1024 // Default 100MB
  }
});

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB || 100}MB`
      });
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Only one file allowed per upload.'
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Unexpected field name. Use "audio" for the file field.'
      });
    }
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  next(error);
};

module.exports = {
  upload: upload.single('audio'),
  handleUploadError
};
