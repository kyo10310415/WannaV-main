export function ensureTutorNameColumn(db) {
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'tutor_name')) {
    db.exec('ALTER TABLE users ADD COLUMN tutor_name TEXT');
  }
}

export function parseTutorName(value) {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf},，、;]/u.test(value)) return { valid: false };
  const normalized = value.trim();
  if ([...normalized].length > 100) return { valid: false };
  return { valid: true, value: normalized || null };
}
