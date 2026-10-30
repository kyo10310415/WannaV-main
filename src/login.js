import { serialize } from 'cookie';
import { requiresInitialCredentialReissue } from './initial-credentials.js';

export function createLoginHandler({ db, bcrypt, jwt, secret }) {
  return async c => {
    try {
      const { username, password } = await c.req.json();
      if (typeof username !== 'string' || typeof password !== 'string') {
        return c.json({ error: 'ユーザー名またはパスワードが正しくありません' }, 401);
      }
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return c.json({ error: 'ユーザー名またはパスワードが正しくありません' }, 401);
      }
      if (requiresInitialCredentialReissue(user, password)) {
        return c.json({ error: '初期パスワードの再発行が必要です。管理者にお問い合わせください。' }, 401);
      }
      const token = jwt.sign({ userId: user.id,
        ...(user.must_change_password ? { initialCredential: true } : {})
      }, secret, { expiresIn: '7d' });
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);
      c.header('Set-Cookie', serialize('auth_token', token, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60, path: '/'
      }));
      c.header('Cache-Control', 'no-store');
      return c.json({ success: true, username: user.username });
    } catch {
      return c.json({ error: 'ログイン処理中にエラーが発生しました' }, 500);
    }
  };
}
