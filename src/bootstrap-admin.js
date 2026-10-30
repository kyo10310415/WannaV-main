export function ensureBootstrapAdmin({ db, bcrypt, env = process.env }) {
  const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get('admin');
  if (existing) {
    if (existing.role !== 'admin') throw new Error('Bootstrap username is already assigned to a non-admin account');
    return false;
  }
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (typeof password !== 'string' || password.length < 32 || password.trim() !== password
    || Buffer.byteLength(password, 'utf8') > 72 || /^(.)\1+$/u.test(password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD (32 characters minimum, 72 UTF-8 bytes maximum) is required only for a new database');
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, ?, ?)')
    .run('admin', hash, 'admin', 1);
  return true;
}
