import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class PostEncryptionService {
  private readonly logger = new Logger(PostEncryptionService.name);
  private readonly masterKey: Buffer;
  public static readonly ENCRYPTION_PREFIX = 'inkenc:v1:';

  constructor(private configService: ConfigService) {
    const rawSecret =
      this.configService.get<string>('ENCRYPTION_MASTER_KEY') ||
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      'inkflow_production_master_encryption_key_2026';

    // Derive a fixed 256-bit (32-byte) master key using HKDF-SHA256 (RFC 5869)
    this.masterKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        Buffer.from(rawSecret, 'utf-8'),
        Buffer.from('inkflow-master-salt-v1', 'utf-8'),
        Buffer.from('inkflow-master-encryption-key-v1', 'utf-8'),
        32,
      ),
    );
  }

  /**
   * Determine if the content is already encrypted with AES-256-GCM.
   */
  isEncrypted(content?: string | null): boolean {
    if (!content || typeof content !== 'string') return false;
    return content.startsWith(PostEncryptionService.ENCRYPTION_PREFIX);
  }

  /**
   * Derive a unique 256-bit AES key per post using HKDF (RFC 5869).
   * This guarantees that even identical stories have completely different keys and ciphertexts.
   */
  private derivePostKey(postId: string): Buffer {
    return Buffer.from(
      crypto.hkdfSync(
        'sha256',
        this.masterKey,
        Buffer.from(postId || 'inkflow-default-post-salt', 'utf-8'),
        Buffer.from('inkflow-private-post-content-aes256', 'utf-8'),
        32,
      ),
    );
  }

  /**
   * Encrypt post content at rest using military-grade AES-256-GCM.
   * Format: inkenc:v1:<12-byte IV in hex>:<16-byte AuthTag in hex>:<Ciphertext in hex>
   */
  encrypt(content: string, postId: string): string {
    if (!content || typeof content !== 'string') return content || '';
    if (this.isEncrypted(content)) {
      return content;
    }

    try {
      const key = this.derivePostKey(postId);
      const iv = crypto.randomBytes(12); // Cryptographically secure 96-bit nonce
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

      let ciphertext = cipher.update(content, 'utf8', 'hex');
      ciphertext += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return `${PostEncryptionService.ENCRYPTION_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
    } catch (error) {
      this.logger.error(`Failed to encrypt content for post '${postId}':`, error);
      throw error;
    }
  }

  /**
   * Decrypt AES-256-GCM ciphertext at rest.
   * Authenticates the integrity using the 128-bit GCM authentication tag.
   * If content is unencrypted (legacy / public), returns plaintext directly.
   */
  decrypt(cipherText: string | null | undefined, postId: string): string {
    if (!cipherText || typeof cipherText !== 'string') return '';
    if (!this.isEncrypted(cipherText)) {
      return cipherText;
    }

    try {
      const parts = cipherText.split(':');
      if (parts.length !== 5) {
        throw new Error('Malformed encrypted payload format');
      }

      const iv = Buffer.from(parts[2], 'hex');
      const authTag = Buffer.from(parts[3], 'hex');
      const rawCipher = parts[4];

      const key = this.derivePostKey(postId);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let plaintext = decipher.update(rawCipher, 'hex', 'utf8');
      plaintext += decipher.final('utf8');

      return plaintext;
    } catch (error) {
      this.logger.error(
        `Failed to decrypt content for post '${postId}'. Authentication tag mismatch or corrupted data:`,
        error,
      );
      return '<p class="text-red-500 font-medium">⚠️ Encrypted content could not be verified or decrypted.</p>';
    }
  }
}
