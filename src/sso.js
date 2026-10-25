import jwt from 'jsonwebtoken';
import { isExtensionSso, TutorSyncError } from './notion-tutor-sync.js';

const levels = { admin: 3, leader: 2, crew: 1 };

export function createSsoHandler({ db, secret, resolveTutorName }) {
  return async c => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid request' }, 400); }
    const systems = db.prepare('SELECT id, url, required_role FROM systems').all();
    const matches = systems.filter(system => body.systemId !== undefined
      ? Number.isSafeInteger(body.systemId) && system.id === body.systemId
      : typeof body.targetUrl === 'string' && system.url === body.targetUrl);
    if (!matches.length) return c.json({ error: 'Unknown system' }, 400);
    // Duplicate legacy URLs must never select a less restrictive registration.
    const user = c.get('user');
    if (!Object.hasOwn(levels, user?.role) || matches.some(s => !Object.hasOwn(levels, s.required_role || 'crew') ||
        levels[user.role] < levels[s.required_role || 'crew'])) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const system = matches[0];
    let url;
    try { url = new URL(system.url); } catch { return c.json({ error: 'Invalid system URL' }, 400); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return c.json({ error: 'Invalid system URL' }, 400);
    }
    const storedUser = user.role === 'crew'
      ? db.prepare('SELECT tutor_name, notion_tutor_approved FROM users WHERE id = ?').get(user.id)
      : null;
    let tutorName = user.role === 'crew' ? (storedUser?.tutor_name ?? null) : null;
    if (user.role === 'crew' && isExtensionSso(url.origin)) {
      if (typeof resolveTutorName !== 'function') return c.json({ error: 'Notionの担当者連携を確認できません。' }, 503);
      if (storedUser?.notion_tutor_approved !== 1) return c.json({ error: '管理者によるNotion連携の初回承認が必要です。' }, 403);
      try {
        tutorName = await resolveTutorName(user.username);
        const current = db.prepare('SELECT id, username, role, notion_tutor_approved FROM users WHERE id = ?').get(user.id);
        if (!current || current.role !== 'crew' || current.username !== user.username || current.notion_tutor_approved !== 1) return c.json({ error: 'Forbidden' }, 403);
        db.prepare('UPDATE users SET tutor_name = ? WHERE id = ?').run(tutorName, user.id);
        if (!tutorName) return c.json({ error: 'Notionにメールアドレスが一致する担当者登録がありません。' }, 403);
      } catch (error) {
        return c.json({ error: error instanceof TutorSyncError ? error.message : new TutorSyncError('upstream').message }, 503);
      }
    }
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role,
      targetUrl: system.url, type: 'sso', tutorName }, secret, {
      algorithm: 'HS256', expiresIn: '1h', issuer: 'https://wannav-main.onrender.com', audience: url.origin
    });
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, token });
  };
}
