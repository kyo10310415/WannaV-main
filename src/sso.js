import jwt from 'jsonwebtoken';

const levels = { admin: 3, leader: 2, crew: 1 };

export function createSsoHandler({ db, secret }) {
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
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role,
      targetUrl: system.url, type: 'sso' }, secret, {
      algorithm: 'HS256', expiresIn: '1h', issuer: 'https://wannav-main.onrender.com', audience: url.origin
    });
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, token });
  };
}
