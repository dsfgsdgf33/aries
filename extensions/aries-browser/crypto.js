/**
 * Aries Browser Extension — Crypto utilities for credential encryption
 * Uses Web Crypto API with AES-GCM, key derived from extension ID
 */

const ArisCrypto = (() => {
  const ALGO = 'AES-GCM';
  const KEY_LENGTH = 256;
  const IV_LENGTH = 12;

  async function getKey() {
    const id = chrome.runtime.id;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(id.padEnd(32, '0').slice(0, 32)),
      { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('aries-salt-v1'), iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: ALGO, length: KEY_LENGTH }, false, ['encrypt', 'decrypt']
    );
  }

  async function encrypt(plaintext) {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt({ name: ALGO, iv }, key, enc.encode(plaintext));
    // Store as base64: iv + ciphertext
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ct), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  async function decrypt(encoded) {
    const key = await getKey();
    const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const iv = raw.slice(0, IV_LENGTH);
    const ct = raw.slice(IV_LENGTH);
    const dec = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ct);
    return new TextDecoder().decode(dec);
  }

  return { encrypt, decrypt };
})();

if (typeof globalThis !== 'undefined') globalThis.ArisCrypto = ArisCrypto;
