const crypto = require('crypto');

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function verifyPayload(payload, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}

module.exports = { signPayload, verifyPayload };
