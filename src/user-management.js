import { canCreateUser, canManageUser } from './security.js';

export function createUserManagementHandlers({ db, bcrypt }) {
  return {
    create: async (c) => {
      try {
        const { username, role } = await c.req.json();
        if (!canCreateUser(c.get('user'), role)) {
          return c.json({ error: 'この権限のユーザーを作成する権限がありません' }, 403);
        }
        const password = '1111'; // 初期パスワードは1111

        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
          return c.json({ error: 'このユーザー名は既に使用されています' }, 400);
        }

        // roleの検証
        if (!['admin', 'leader', 'crew'].includes(role)) {
          return c.json({ error: '無効な権限です' }, 400);
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        // admin以外は初回パスワード変更を要求
        const mustChangePassword = username !== 'admin' ? 1 : 0;

        const result = db.prepare('INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, ?, ?)').run(username, hashedPassword, role, mustChangePassword);

        console.log(`✅ 新規ユーザー作成: ${username} (role: ${role})`);

        return c.json({ success: true, userId: result.lastInsertRowid });
      } catch (error) {
        console.error('Add user error:', error);
        return c.json({ error: 'ユーザー追加中にエラーが発生しました' }, 500);
      }
    },
    password: async (c) => {
      try {
        const userId = c.req.param('id');
        const { password } = await c.req.json();

        const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
        if (!target) return c.json({ error: 'ユーザーが見つかりません' }, 404);
        if (!canManageUser(c.get('user'), target)) {
          return c.json({ error: 'このユーザーを変更する権限がありません' }, 403);
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);

        // そのユーザーの全セッションを削除（再ログインを強制）
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

        return c.json({ success: true });
      } catch (error) {
        console.error('Change password error:', error);
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
