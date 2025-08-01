const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const securityConfig = require('../config/security');
const logger = require('./logger');

class EncryptionService {
  constructor() {
    this.algorithm = securityConfig.encryption.algorithm;
    this.keyDerivation = securityConfig.encryption.keyDerivation;
    this.iterations = securityConfig.encryption.iterations;
    this.saltLength = securityConfig.encryption.saltLength;
    this.ivLength = securityConfig.encryption.ivLength;
    this.tagLength = securityConfig.encryption.tagLength;
    
    // Use environment variable or generate a master key
    this.masterKey = process.env.ENCRYPTION_MASTER_KEY || this.generateMasterKey();
    
    if (!process.env.ENCRYPTION_MASTER_KEY) {
      logger.warn('ENCRYPTION_MASTER_KEY not set in environment. Using generated key (not recommended for production)');
    }
  }

  // Generate a master key (should be stored securely in production)
  generateMasterKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Derive key from master key and salt
  deriveKey(salt, masterKey = this.masterKey) {
    return crypto.pbkdf2Sync(masterKey, salt, this.iterations, 32, 'sha256');
  }

  // Encrypt data (string or buffer)
  encrypt(data, additionalData = null) {
    try {
      // Convert string to buffer if needed
      const plaintext = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      
      // Generate random salt and IV
      const salt = crypto.randomBytes(this.saltLength);
      const iv = crypto.randomBytes(this.ivLength);
      
      // Derive key from master key and salt
      const key = this.deriveKey(salt);
      
      // Create cipher
      const cipher = crypto.createCipherGCM(this.algorithm, key, iv);
      
      // Add additional authenticated data if provided
      if (additionalData) {
        cipher.setAAD(Buffer.from(additionalData));
      }
      
      // Encrypt data
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
      ]);
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      // Combine all components: salt + iv + tag + encrypted data
      const result = Buffer.concat([salt, iv, tag, encrypted]);
      
      return {
        encrypted: result.toString('base64'),
        algorithm: this.algorithm,
        keyDerivation: this.keyDerivation,
        iterations: this.iterations
      };
    } catch (error) {
      logger.error('Encryption error:', error);
      throw new Error('Encryption failed');
    }
  }

  // Decrypt data
  decrypt(encryptedData, additionalData = null, masterKey = this.masterKey) {
    try {
      // Parse encrypted data structure
      const encryptedBuffer = Buffer.from(encryptedData.encrypted, 'base64');
      
      // Extract components
      const salt = encryptedBuffer.slice(0, this.saltLength);
      const iv = encryptedBuffer.slice(this.saltLength, this.saltLength + this.ivLength);
      const tag = encryptedBuffer.slice(this.saltLength + this.ivLength, this.saltLength + this.ivLength + this.tagLength);
      const encrypted = encryptedBuffer.slice(this.saltLength + this.ivLength + this.tagLength);
      
      // Derive key
      const key = this.deriveKey(salt, masterKey);
      
      // Create decipher
      const decipher = crypto.createDecipherGCM(encryptedData.algorithm || this.algorithm, key, iv);
      decipher.setAuthTag(tag);
      
      // Add additional authenticated data if provided
      if (additionalData) {
        decipher.setAAD(Buffer.from(additionalData));
      }
      
      // Decrypt data
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption error:', error);
      throw new Error('Decryption failed');
    }
  }

  // Encrypt file at path
  async encryptFile(filePath, outputPath = null) {
    try {
      // Read file
      const fileData = await fs.readFile(filePath);
      
      // Get file metadata for additional authenticated data
      const stats = await fs.stat(filePath);
      const additionalData = JSON.stringify({
        originalName: path.basename(filePath),
        size: stats.size,
        mtime: stats.mtime.toISOString()
      });
      
      // Encrypt file data
      const encrypted = this.encrypt(fileData, additionalData);
      
      // Create encrypted file metadata
      const encryptedFileData = {
        ...encrypted,
        metadata: {
          originalName: path.basename(filePath),
          originalSize: stats.size,
          encryptedAt: new Date().toISOString(),
          version: '1.0'
        }
      };
      
      // Determine output path
      const outputFilePath = outputPath || filePath + '.enc';
      
      // Write encrypted file
      await fs.writeFile(outputFilePath, JSON.stringify(encryptedFileData, null, 2));
      
      logger.info(`File encrypted: ${filePath} -> ${outputFilePath}`);
      
      return {
        originalPath: filePath,
        encryptedPath: outputFilePath,
        metadata: encryptedFileData.metadata
      };
    } catch (error) {
      logger.error('File encryption error:', error);
      throw new Error('File encryption failed');
    }
  }

  // Decrypt file at path
  async decryptFile(encryptedFilePath, outputPath = null) {
    try {
      // Read encrypted file
      const encryptedFileContent = await fs.readFile(encryptedFilePath, 'utf8');
      const encryptedFileData = JSON.parse(encryptedFileContent);
      
      // Prepare additional data for verification
      const additionalData = JSON.stringify({
        originalName: encryptedFileData.metadata.originalName,
        size: encryptedFileData.metadata.originalSize,
        mtime: new Date(encryptedFileData.metadata.encryptedAt).toISOString()
      });
      
      // Decrypt file data
      const decryptedData = this.decrypt(encryptedFileData, additionalData);
      
      // Determine output path
      const outputFilePath = outputPath || path.join(
        path.dirname(encryptedFilePath),
        encryptedFileData.metadata.originalName
      );
      
      // Write decrypted file
      await fs.writeFile(outputFilePath, decryptedData);
      
      logger.info(`File decrypted: ${encryptedFilePath} -> ${outputFilePath}`);
      
      return {
        encryptedPath: encryptedFilePath,
        decryptedPath: outputFilePath,
        metadata: encryptedFileData.metadata
      };
    } catch (error) {
      logger.error('File decryption error:', error);
      throw new Error('File decryption failed');
    }
  }

  // Encrypt file stream (for large files)
  createEncryptStream(additionalData = null) {
    try {
      // Generate random salt and IV
      const salt = crypto.randomBytes(this.saltLength);
      const iv = crypto.randomBytes(this.ivLength);
      
      // Derive key
      const key = this.deriveKey(salt);
      
      // Create cipher stream
      const cipher = crypto.createCipherGCM(this.algorithm, key, iv);
      
      // Add additional authenticated data if provided
      if (additionalData) {
        cipher.setAAD(Buffer.from(additionalData));
      }
      
      // Store metadata for later use
      cipher._encryptionMetadata = {
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        algorithm: this.algorithm,
        keyDerivation: this.keyDerivation,
        iterations: this.iterations
      };
      
      // Override end method to append authentication tag
      const originalEnd = cipher.end;
      cipher.end = function(chunk, encoding, callback) {
        originalEnd.call(this, chunk, encoding, () => {
          const tag = this.getAuthTag();
          this._encryptionMetadata.tag = tag.toString('base64');
          if (callback) callback();
        });
      };
      
      return cipher;
    } catch (error) {
      logger.error('Error creating encrypt stream:', error);
      throw new Error('Failed to create encryption stream');
    }
  }

  // Decrypt file stream
  createDecryptStream(metadata, additionalData = null) {
    try {
      // Parse metadata
      const salt = Buffer.from(metadata.salt, 'base64');
      const iv = Buffer.from(metadata.iv, 'base64');
      const tag = Buffer.from(metadata.tag, 'base64');
      
      // Derive key
      const key = this.deriveKey(salt);
      
      // Create decipher stream
      const decipher = crypto.createDecipherGCM(metadata.algorithm || this.algorithm, key, iv);
      decipher.setAuthTag(tag);
      
      // Add additional authenticated data if provided
      if (additionalData) {
        decipher.setAAD(Buffer.from(additionalData));
      }
      
      return decipher;
    } catch (error) {
      logger.error('Error creating decrypt stream:', error);
      throw new Error('Failed to create decryption stream');
    }
  }

  // Generate file encryption key (for per-file encryption)
  generateFileKey() {
    return crypto.randomBytes(32).toString('base64');
  }

  // Hash data with salt
  hash(data, salt = null) {
    try {
      const actualSalt = salt || crypto.randomBytes(16);
      const hash = crypto.pbkdf2Sync(data, actualSalt, 10000, 64, 'sha256');
      
      return {
        hash: hash.toString('hex'),
        salt: actualSalt.toString('hex')
      };
    } catch (error) {
      logger.error('Hashing error:', error);
      throw new Error('Hashing failed');
    }
  }

  // Verify hash
  verifyHash(data, hashedData) {
    try {
      const salt = Buffer.from(hashedData.salt, 'hex');
      const hash = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha256');
      
      return hash.toString('hex') === hashedData.hash;
    } catch (error) {
      logger.error('Hash verification error:', error);
      return false;
    }
  }

  // Generate checksum for file integrity
  async generateFileChecksum(filePath, algorithm = 'sha256') {
    try {
      const fileData = await fs.readFile(filePath);
      const hash = crypto.createHash(algorithm);
      hash.update(fileData);
      
      return {
        checksum: hash.digest('hex'),
        algorithm,
        size: fileData.length,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Checksum generation error:', error);
      throw new Error('Checksum generation failed');
    }
  }

  // Verify file checksum
  async verifyFileChecksum(filePath, expectedChecksum) {
    try {
      const currentChecksum = await this.generateFileChecksum(filePath, expectedChecksum.algorithm);
      
      return {
        valid: currentChecksum.checksum === expectedChecksum.checksum,
        expected: expectedChecksum.checksum,
        actual: currentChecksum.checksum,
        algorithm: expectedChecksum.algorithm
      };
    } catch (error) {
      logger.error('Checksum verification error:', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Secure file deletion (overwrites file multiple times)
  async secureDelete(filePath, passes = 3) {
    try {
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      
      // Multiple overwrite passes
      for (let pass = 0; pass < passes; pass++) {
        // Generate random data
        const randomData = crypto.randomBytes(fileSize);
        
        // Overwrite file
        await fs.writeFile(filePath, randomData);
        
        // Sync to ensure data is written to disk
        const fd = await fs.open(filePath, 'r+');
        await fd.sync();
        await fd.close();
      }
      
      // Final pass with zeros
      const zeroData = Buffer.alloc(fileSize, 0);
      await fs.writeFile(filePath, zeroData);
      
      // Delete file
      await fs.unlink(filePath);
      
      logger.info(`File securely deleted: ${filePath}`);
      return true;
    } catch (error) {
      logger.error('Secure deletion error:', error);
      throw new Error('Secure deletion failed');
    }
  }

  // Encrypt sensitive data for database storage
  encryptForDatabase(data) {
    try {
      if (!data) return null;
      
      const encrypted = this.encrypt(JSON.stringify(data));
      return encrypted.encrypted; // Return only the encrypted string for database
    } catch (error) {
      logger.error('Database encryption error:', error);
      return null;
    }
  }

  // Decrypt sensitive data from database
  decryptFromDatabase(encryptedData) {
    try {
      if (!encryptedData) return null;
      
      const decrypted = this.decrypt({ encrypted: encryptedData });
      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      logger.error('Database decryption error:', error);
      return null;
    }
  }

  // Key rotation utilities
  async rotateKey(oldMasterKey, newMasterKey) {
    try {
      // This would be used to re-encrypt data with a new master key
      // Implementation depends on specific needs
      logger.info('Key rotation initiated');
      
      // Update instance master key
      this.masterKey = newMasterKey;
      
      return true;
    } catch (error) {
      logger.error('Key rotation error:', error);
      throw new Error('Key rotation failed');
    }
  }

  // Generate encryption report for audit
  generateEncryptionReport() {
    return {
      algorithm: this.algorithm,
      keyDerivation: this.keyDerivation,
      iterations: this.iterations,
      saltLength: this.saltLength,
      ivLength: this.ivLength,
      tagLength: this.tagLength,
      masterKeySet: !!process.env.ENCRYPTION_MASTER_KEY,
      generatedAt: new Date().toISOString()
    };
  }
}

// Export singleton instance
const encryptionService = new EncryptionService();

// Helper functions for easy use
const encrypt = (data, additionalData) => encryptionService.encrypt(data, additionalData);
const decrypt = (encryptedData, additionalData, masterKey) => encryptionService.decrypt(encryptedData, additionalData, masterKey);
const encryptFile = (filePath, outputPath) => encryptionService.encryptFile(filePath, outputPath);
const decryptFile = (encryptedFilePath, outputPath) => encryptionService.decryptFile(encryptedFilePath, outputPath);
const hash = (data, salt) => encryptionService.hash(data, salt);
const verifyHash = (data, hashedData) => encryptionService.verifyHash(data, hashedData);
const secureDelete = (filePath, passes) => encryptionService.secureDelete(filePath, passes);

module.exports = {
  encryptionService,
  encrypt,
  decrypt,
  encryptFile,
  decryptFile,
  hash,
  verifyHash,
  secureDelete
};