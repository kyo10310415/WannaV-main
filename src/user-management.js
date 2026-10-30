import { createInitialPassword } from './initial-credentials.js';
import { parseTutorName } from './tutor-mapping.js';
import { canCreateUser, canManageUser } from './security.js';

export function createUserManagementHandlers({ db, bcrypt }) {
  return {
    create: async (c) => {
      try {
        const { username, role } = await c.req.json();
        if (!canCreateUser(c.get('user'), role)) {
          return c.json({ error: 'この権限のユーザーを作成する権限がありません' }, 403);
        }

        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
          return c.json({ error: 'このユーザー名は既に使用されています' }, 400);
        }

        // roleの検証
        if (!['admin', 'leader', 'crew'].includes(role)) {
          return c.json({ error: '無効な権限です' }, 400);
        }

        const password = createInitialPassword();
        const hashedPassword = bcrypt.hashSync(password, 10);
        // All newly issued credentials require a first-login password change.
        const mustChangePassword = 1;

        const result = db.prepare('INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, ?, ?)').run(username, hashedPassword, role, mustChangePassword);

        console.log('User credential issued');

        c.header('Cache-Control', 'no-store');
        return c.json({ success: true, userId: result.lastInsertRowid, initialPassword: password });
      } catch (error) {
        console.error('Add user failed');
        return c.json({ error: 'ユーザー追加中にエラーが発生しました' }, 500);
      }
    },
    tutor: async (c) => {
      if (c.get('user')?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
      let body;
      try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid request' }, 400); }
      const parsed = parseTutorName(body?.tutorName);
      if (!parsed.valid) return c.json({ error: '担任Tutor名は100文字以内の単一の名前を指定してください' }, 400);
      const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(c.req.param('id'));
      if (!target) return c.json({ error: 'ユーザーが見つかりません' }, 404);
      if (target.role !== 'crew') return c.json({ error: 'crewのみ対応付けできます' }, 400);
      db.prepare('UPDATE users SET tutor_name = ? WHERE id = ?').run(parsed.value, target.id);
      c.header('Cache-Control', 'no-store');
      return c.json({ success: true });
    },
    password: async (c) => {
      try {
        const userId = c.req.param('id');

        const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
        if (!target) return c.json({ error: 'ユーザーが見つかりません' }, 404);
        if (!canManageUser(c.get('user'), target)) {
          return c.json({ error: 'このユーザーを変更する権限がありません' }, 403);
        }

        const password = createInitialPassword();
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare('UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?').run(hashedPassword, userId);

        // そのユーザーの全セッションを削除（再ログインを強制）
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

        c.header('Cache-Control', 'no-store');
        return c.json({ success: true, initialPassword: password });
      } catch (error) {
        console.error('Password reissue failed');
        return c.json({ error: 'パスワード変更中にエラーが発生しました' }, 500);
      }
    },
    remove: async (c) => {
      try {
        const userId = c.req.param('id');

        const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
        if (!target) return c.json({ error: 'ユーザーが見つかりません' }, 404);
        if (!canManageUser(c.get('user'), target)) {
          return c.json({ error: 'このユーザーを変更する権限がありません' }, 403);
        }

        // adminユーザーは削除不可
        if (target.username === 'admin') {
          return c.json({ error: 'デフォルト管理者は削除できません' }, 400);
        }

        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        return c.json({ success: true });
      } catch (error) {
        console.error('Delete user error:', error);
        return c.json({ error: 'ユーザー削除中にエラーが発生しました' }, 500);
      }
    },
  };
}
