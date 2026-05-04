const crypto = require('crypto');
const { createEncryptionKey } = require('../config/env');

class EncryptionService {
    constructor(secret) {
        this.key = createEncryptionKey(secret);
    }

    encrypt(value) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(value), 'utf8'),
            cipher.final()
        ]);

        return {
            algorithm: 'aes-256-gcm',
            iv: iv.toString('base64'),
            authTag: cipher.getAuthTag().toString('base64'),
            ciphertext: encrypted.toString('base64')
        };
    }

    decrypt(payload) {
        if (!payload?.ciphertext || !payload?.iv || !payload?.authTag) {
            return null;
        }

        const decipher = crypto.createDecipheriv(
            payload.algorithm || 'aes-256-gcm',
            this.key,
            Buffer.from(payload.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(payload.ciphertext, 'base64')),
            decipher.final()
        ]);

        return JSON.parse(decrypted.toString('utf8'));
    }
}

module.exports = EncryptionService;
