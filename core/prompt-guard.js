'use strict';

let sensitivity = 'medium'; // low | medium | high

const THRESHOLDS = { low: 70, medium: 45, high: 20 };

// Pattern categories with weights
const PATTERNS = {
  systemOverride: {
    weight: 30,
    label: 'system_prompt_override',
    patterns: [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /ignore\s+(all\s+)?above\s+instructions/i,
      /disregard\s+(all\s+)?(previous|prior|above)/i,
      /you\s+are\s+now\s+(?!going\s+to\s+help)/i,
      /new\s+instructions?\s*:/i,
      /forget\s+(everything|all|your)\s+(above|previous|prior)/i,
      /override\s+(system|safety|previous)\s+(prompt|instructions|rules)/i,
      /\bsystem\s*prompt\s*:\s*/i,
      /act\s+as\s+if\s+you\s+have\s+no\s+(restrictions|rules|guidelines)/i,
      /from\s+now\s+on,?\s+you\s+(will|must|should|are)/i,
    ]
  },
  dataExfil: {
    weight: 35,
    label: 'data_exfiltration',
    patterns: [
      /send\s+(this|it|the\s+data|everything|all)\s+to\s+/i,
      /upload\s+(this|it|to)\s+/i,
      /post\s+to\s+https?:\/\//i,
      /fetch\s*\(\s*['"]https?:\/\//i,
      /curl\s+.*https?:\/\//i,
      /wget\s+https?:\/\//i,
      /exfiltrate/i,
      /base64\s*[\-_]?(encode|decode)/i,
      /btoa\s*\(/i,
      /\.pipe\s*\(\s*require\s*\(\s*['"]net['"]\)/i,
    ]
  },
  shellInjection: {
    weight: 35,
    label: 'shell_injection',
    patterns: [
      /`[^`]*`/,                          // backtick commands
      /\$\([^)]+\)/,                       // $() subshell
      /\|\s*(curl|wget|nc|ncat|bash|sh|python|ruby|perl|php)\b/i,
      /;\s*(curl|wget|nc|rm|chmod|chown|dd|mkfs)\b/i,
      /&&\s*(curl|wget|nc|bash|sh)\b/i,
      />\s*\/etc\//,                       // write to system dirs
      /\brm\s+(-rf?|--force)\s+\//i,
      /\bchmod\s+[0-7]{3,4}\s+\//i,
      /\beval\s*\(/,
      /\bnew\s+Function\s*\(/,
    ]
  },
  jailbreak: {
    weight: 25,
    label: 'jailbreak_attempt',
    patterns: [
      /\bDAN\s+(mode|prompt)/i,
      /\bdo\s+anything\s+now\b/i,
      /\bdeveloper\s+mode\s+(enabled|on|activated)/i,
      /\bjailbreak(ed)?\b/i,
      /\bhypothetically\b.*\b(how|can|would)\b.*\b(hack|exploit|attack|steal|bypass)/i,
      /\bpretend\s+(you\s+)?(are|have)\s+no\s+(restrictions|limits|rules)/i,
      /\brole\s*play\s+as\s+an?\s+(evil|malicious|unrestricted)/i,
      /in\s+(fiction|a\s+story|a\s+novel),?\s+(how|explain)/i,
      /\bfor\s+(educational|research)\s+purposes?\s+(only)?,?\s+(how|explain|show)/i,
      /\bopposite\s+day\b/i,
    ]
  },
  unicode: {
    weight: 20,
    label: 'unicode_homoglyph',
    patterns: [
      /[\u200B-\u200F\u2028-\u202F\uFEFF]/,           // zero-width & invisible chars
      /[\u0400-\u04FF].*[a-zA-Z]|[a-zA-Z].*[\u0400-\u04FF]/,  // mixed Cyrillic+Latin
      /[\u0370-\u03FF].*[a-zA-Z]/,                      // mixed Greek+Latin
      /[\uFF01-\uFF5E]/,                                // fullwidth ASCII
      /[\u2060-\u2064]/,                                 // invisible operators
      /[\u00AD]/,                                        // soft hyphen
    ]
  }
};

function detectRepetition(text) {
  // Token stuffing: same phrase repeated many times
  const words = text.split(/\s+/);
  if (words.length < 20) return { detected: false, score: 0 };

  const freq = {};
  const trigrams = [];
  for (let i = 0; i < words.length - 2; i++) {
    const tri = words.slice(i, i + 3).join(' ').toLowerCase();
    trigrams.push(tri);
    freq[tri] = (freq[tri] || 0) + 1;
  }

  if (trigrams.length === 0) return { detected: false, score: 0 };

  const maxFreq = Math.max(...Object.values(freq));
  const ratio = maxFreq / trigrams.length;

  if (ratio > 0.3 && maxFreq > 5) {
    return { detected: true, score: Math.min(ratio * 100, 40) };
  }
  return { detected: false, score: 0 };
}

function scan(text) {
  if (!text || typeof text !== 'string') {
    return { safe: true, threats: [], score: 0 };
  }

  const threats = [];
  let score = 0;

  for (const [, category] of Object.entries(PATTERNS)) {
    for (const pat of category.patterns) {
      if (pat.test(text)) {
        if (!threats.includes(category.label)) {
          threats.push(category.label);
          score += category.weight;
        }
        break; // one match per category is enough
      }
    }
  }

  const rep = detectRepetition(text);
  if (rep.detected) {
    threats.push('token_stuffing');
    score += rep.score;
  }

  score = Math.min(score, 100);
  const threshold = THRESHOLDS[sensitivity];

  return {
    safe: score < threshold,
    threats,
    score
  };
}

function sanitize(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // Strip zero-width and invisible characters
  result = result.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u2060-\u2064\u00AD]/g, '');

  // Strip fullwidth ASCII → normal ASCII
  result = result.replace(/[\uFF01-\uFF5E]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );

  // Neutralize backtick subshells
  result = result.replace(/`([^`]*)`/g, '\'$1\'');
  result = result.replace(/\$\(([^)]*)\)/g, '($1)');

  // Neutralize system override phrases (prefix with [blocked])
  const overridePatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /new\s+instructions?\s*:/gi,
    /you\s+are\s+now\b/gi,
    /forget\s+(everything|all|your)\s+(above|previous|prior)/gi,
  ];
  for (const pat of overridePatterns) {
    result = result.replace(pat, '[blocked]');
  }

  return result;
}

function configure(opts = {}) {
  if (opts.sensitivity && ['low', 'medium', 'high'].includes(opts.sensitivity)) {
    sensitivity = opts.sensitivity;
  }
}

module.exports = { scan, sanitize, configure };
