import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as crypto from 'crypto';

// Load environment variables from .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

const ENCRYPTION_PREFIX = 'inkenc:v1:';

function getMasterKey(): Buffer {
  const rawSecret =
    process.env.ENCRYPTION_MASTER_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_REFRESH_SECRET ||
    'inkflow_production_master_encryption_key_2026';

  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(rawSecret, 'utf-8'),
      Buffer.from('inkflow-master-salt-v1', 'utf-8'),
      Buffer.from('inkflow-master-encryption-key-v1', 'utf-8'),
      32,
    ),
  );
}

const masterKey = getMasterKey();

function derivePostKey(postId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(postId || 'inkflow-default-post-salt', 'utf-8'),
      Buffer.from('inkflow-private-post-content-aes256', 'utf-8'),
      32,
    ),
  );
}

function encrypt(content: string, postId: string): string {
  if (!content || typeof content !== 'string') return content || '';
  if (content.startsWith(ENCRYPTION_PREFIX)) return content;

  const key = derivePostKey(postId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(content, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

function decrypt(cipherText: string, postId: string): string {
  if (!cipherText || !cipherText.startsWith(ENCRYPTION_PREFIX)) return cipherText;

  const parts = cipherText.split(':');
  const iv = Buffer.from(parts[2], 'hex');
  const authTag = Buffer.from(parts[3], 'hex');
  const rawCipher = parts[4];

  const key = derivePostKey(postId);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(rawCipher, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

async function migratePrivatePosts() {
  console.log('====================================================');
  console.log('🔒 INKFLOW PRIVATE BLOGS ENCRYPTION MIGRATION SCRIPT');
  console.log('====================================================');
  console.log(`📡 Connecting to MongoDB Database...`);

  try {
    // Find all private posts
    const privatePosts = await prisma.post.findMany({
      where: {
        OR: [
          { visibility: 'PRIVATE' },
          { secretPasswordHash: { not: null } },
        ],
      },
      select: {
        id: true,
        title: true,
        slug: true,
        visibility: true,
        content: true,
        authorId: true,
      },
    });

    console.log(`🔍 Found ${privatePosts.length} private posts in database.`);

    let alreadyEncryptedCount = 0;
    let newlyEncryptedCount = 0;
    let errorCount = 0;

    for (const post of privatePosts) {
      if (!post.content) {
        console.log(`⏩ [Skipping] Post '${post.title}' (${post.id}) has empty content.`);
        continue;
      }

      if (post.content.startsWith(ENCRYPTION_PREFIX)) {
        alreadyEncryptedCount++;
        console.log(`✅ [Already Encrypted] Post '${post.title}' (${post.id}) is already encrypted with AES-256-GCM.`);
        continue;
      }

      try {
        const originalPlaintext = post.content;
        const cipherText = encrypt(originalPlaintext, post.id);

        // Verification safety check before saving: decrypt in memory and assert identical match
        const verifiedPlaintext = decrypt(cipherText, post.id);
        if (verifiedPlaintext !== originalPlaintext) {
          throw new Error(`Integrity check failed: decrypted text does not match original plaintext for post ${post.id}`);
        }

        // Update post with encrypted content
        await prisma.post.update({
          where: { id: post.id },
          data: { content: cipherText },
        });

        newlyEncryptedCount++;
        console.log(`🔐 [Encrypted & Saved] Post '${post.title}' (${post.id}) successfully encrypted.`);
      } catch (err: any) {
        errorCount++;
        console.error(`❌ [Error] Failed to encrypt post '${post.title}' (${post.id}):`, err.message);
      }
    }

    console.log('\n====================================================');
    console.log('📊 MIGRATION SUMMARY:');
    console.log(`- Total Private Posts Found: ${privatePosts.length}`);
    console.log(`- Newly Encrypted Posts:     ${newlyEncryptedCount}`);
    console.log(`- Already Encrypted Posts:   ${alreadyEncryptedCount}`);
    console.log(`- Errors:                    ${errorCount}`);
    console.log(`- Deleted Posts:             0 (All private posts preserved safely)`);
    console.log('====================================================');
  } catch (err: any) {
    console.error('Fatal migration error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

migratePrivatePosts();
