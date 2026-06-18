'use strict';
/**
 * Hash e validação de senha administrativa usando scrypt nativo do Node.js.
 *
 * Formato persistido:
 *   scrypt$<salt-hex>$<hash-hex>
 */
const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (!password || password.length < 12) {
    throw new Error('A senha administrativa deve ter pelo menos 12 caracteres');
  }
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const [algorithm, saltHex, hashHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
