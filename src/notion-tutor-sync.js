import { parseTutorName } from './tutor-mapping.js';

export const TUTOR_DATABASE_ID = '2f6c668b8d194ae3ba75f6acb5bb7ce2';
const EMAIL_PROPERTY = 'メールアドレス';
const NAME_PROPERTY = 'Notion名';
const EXTENSION_ORIGIN = 'https://extended-management.onrender.com';
const DASHBOARD_ORIGIN = 'https://wannav-main.onrender.com';

export class TutorSyncError extends Error {
  constructor(code) {
    const messages = {
      account_email: 'このアカウントのユーザー名がメールアドレス形式ではありません。',
      ambiguous: 'Notionのメールアドレスが複数行に一致します。重複登録を確認してください。',
      ambiguous_name: '担当名の重複、または照合中の登録変更を検出しました。Notionの担当者登録を確認してください。',
      invalid_person: 'Notion名にはユーザーを1人だけ登録してください。ユーザー情報の読取り権限も確認してください。',
      roster_profile: '担当表にプロフィールを取得できないユーザーがあります。Notionインテグレーションのユーザー情報読取り権限を確認してください。',
      invalid_name: 'Notionの担当名が空欄、長すぎる、または利用できない文字を含んでいます。',
      permissions: 'Notionの読取り権限が不足しています。接続とインテグレーションの権限を確認してください。',
      credentials: 'NotionのAPIキーを認証できません。Renderの設定を確認してください。',
      not_found: 'Notionの対象データベースを取得できません。接続先と共有設定を確認してください。',
      rate_limit: 'Notionの利用回数制限に達しました。少し待ってから1件ずつ再試行してください。',
      roster_limit: '担当表が検査上限を超えたため同期を停止しました。管理者へ連絡してください。',
    };
    super(messages[code] || 'Notionの担当者情報を確認できません。管理者が接続設定・登録内容を確認してください。');
    this.code = code;
  }
}

function id(value) {
  if (typeof value !== 'string' || !/^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.test(value)) {
    throw new TutorSyncError('configuration');
  }
  return value;
}

function propertyText(property) {
  if (!property) throw new TutorSyncError('schema');
  if (property.type === 'people') {
    if (!Array.isArray(property.people) || property.people.length !== 1 || property.has_more
      || property.people[0].type !== 'person' || !property.people[0].id
      || typeof property.people[0].name !== 'string') throw new TutorSyncError('invalid_person');
    return property.people[0].name;
  }
  if (property.type === 'email') return property.email;
  if (['title', 'rich_text'].includes(property.type) && Array.isArray(property[property.type])) {
    return property[property.type].map(part => part.plain_text ?? part.text?.content ?? '').join('');
  }
  if (property.type === 'select') return property.select?.name ?? null;
  if (property.type === 'formula' && property.formula?.type === 'string') return property.formula.string;
  throw new TutorSyncError('schema');
}

// No persistent positive cache: every new extension SSO revalidates identity.
export function createNotionTutorResolver({ env = process.env, fetchImplementation = globalThis.fetch } = {}) {
  const inFlight = new Map();
  let metadata;
  async function request(path, body) {
    const key = env.NOTION_API_KEY;
    if (typeof key !== 'string' || !key.trim()) throw new TutorSyncError('configuration');
    try {
      const response = await fetchImplementation(`https://api.notion.com/v1${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${key}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new TutorSyncError(({ 401: 'credentials', 403: 'permissions', 404: 'not_found', 429: 'rate_limit' })[response.status] || 'upstream');
      return await response.json();
    } catch (error) {
      throw error instanceof TutorSyncError ? error : new TutorSyncError('upstream');
    }
  }
  async function getMetadata() {
    if (metadata && metadata.expires > Date.now()) return metadata;
    let sourceId = env.NOTION_TUTOR_DATA_SOURCE_ID;
    if (!sourceId) {
      const database = await request(`/databases/${id(env.NOTION_TUTOR_DATABASE_ID || TUTOR_DATABASE_ID)}`);
      if (database.data_sources?.length !== 1) throw new TutorSyncError('configuration');
      sourceId = database.data_sources[0].id;
    }
    const source = await request(`/data_sources/${id(sourceId)}`);
    const email = source.properties?.[EMAIL_PROPERTY];
    const name = source.properties?.[NAME_PROPERTY];
    if (!email) throw new TutorSyncError('schema_email_missing');
    if (!name) throw new TutorSyncError('schema_tutor_missing');
    if (!['email', 'rich_text', 'title'].includes(email.type)) throw new TutorSyncError('schema_email_type');
    if (!['title', 'rich_text', 'select', 'formula', 'people'].includes(name.type)) throw new TutorSyncError('schema_tutor_type');
    if (typeof email.id !== 'string' || typeof name.id !== 'string') throw new TutorSyncError('schema');
    metadata = { sourceId, email, name, expires: Date.now() + 60000 };
    return metadata;
  }
  async function resolve(username) {
    if (typeof username !== 'string' || username.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      throw new TutorSyncError('account_email');
    }
    try {
      const { sourceId, email, name } = await getMetadata();
      const query = new URLSearchParams();
      query.append('filter_properties', email.id); query.append('filter_properties', name.id);
      const result = await request(`/data_sources/${id(sourceId)}/query?${query}`, {
        page_size: 2, filter: { property: email.id, [email.type]: { equals: username } },
      });
      if (!Array.isArray(result.results)) throw new TutorSyncError('upstream');
      // Even identical duplicate rows are ambiguous grants; do not pick one.
      if (result.has_more || result.results.length > 1) throw new TutorSyncError('ambiguous');
      if (result.results.length === 0) return null;
      const row = result.results[0];
      if (row.archived || row.in_trash) return null;
      const properties = row.properties || {};
      const get = (definition, label, values = properties) => values[label]
        || Object.values(values).find(property => property?.id === definition.id);
      if (propertyText(get(email, EMAIL_PROPERTY)) !== username) return null;
      const rawName = propertyText(get(name, NAME_PROPERTY));
      const parsed = parseTutorName(rawName);
      if (!parsed.valid || !parsed.value || parsed.value !== rawName) throw new TutorSyncError('invalid_name');
      if (name.type === 'people') {
        // People filters accept IDs, not display names. Check all projected tutor
        // values so different Notion users with the same name cannot share access.
        let cursor, matches = 0;
        const seenCursors = new Set();
        const profiles = new Map();
        const personId = get(name, NAME_PROPERTY).people[0].id;
        for (let page = 0; page < 10; page++) {
          const batch = await request(`/data_sources/${id(sourceId)}/query?${query}`, {
            page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
          });
          if (!Array.isArray(batch.results)) throw new TutorSyncError('upstream');
          for (const candidate of batch.results) {
            if (candidate.archived || candidate.in_trash) continue;
            const property = get(name, NAME_PROPERTY, candidate.properties || {});
            if (property?.type !== 'people' || !Array.isArray(property.people) || property.has_more) throw new TutorSyncError('invalid_person');
            for (const person of property.people) {
              if (!person.id) throw new TutorSyncError('roster_profile');
              let displayName = person.name;
              if (typeof displayName !== 'string') {
                // Page properties may contain partial user objects. Resolve
                // missing names without logging or persisting the profile.
                if (!profiles.has(person.id)) {
                  if (profiles.size >= 20) throw new TutorSyncError('roster_limit');
                  const profile = await request(`/users/${id(person.id)}`);
                  if (profile.id !== person.id || typeof profile.name !== 'string') throw new TutorSyncError('roster_profile');
                  profiles.set(person.id, profile.name);
                }
                displayName = profiles.get(person.id);
              }
              if (displayName !== parsed.value) continue;
              if (++matches !== 1 || candidate.id !== row.id || person.id !== personId
                || property.people.length !== 1
                || propertyText(get(email, EMAIL_PROPERTY, candidate.properties || {})) !== username) throw new TutorSyncError('ambiguous_name');
            }
          }
          if (!batch.has_more) {
            if (matches !== 1) throw new TutorSyncError('ambiguous_name');
            return parsed.value;
          }
          if (typeof batch.next_cursor !== 'string' || !batch.next_cursor || seenCursors.has(batch.next_cursor)) throw new TutorSyncError('upstream');
          cursor = batch.next_cursor;
          seenCursors.add(cursor);
        }
        throw new TutorSyncError('roster_limit');
      }
      const nameFilter = name.type === 'formula' ? { formula: { string: { equals: parsed.value } } }
        : { [name.type]: { equals: parsed.value } };
      const sameName = await request(`/data_sources/${id(sourceId)}/query?${query}`, {
        page_size: 2, filter: { property: name.id, ...nameFilter },
      });
      if (!Array.isArray(sameName.results) || sameName.has_more || sameName.results.length !== 1
        || !row.id || sameName.results[0].id !== row.id) throw new TutorSyncError('ambiguous_name');
      const confirmed = sameName.results[0];
      if (confirmed.archived || confirmed.in_trash
        || propertyText(get(email, EMAIL_PROPERTY, confirmed.properties || {})) !== username
        || propertyText(get(name, NAME_PROPERTY, confirmed.properties || {})) !== parsed.value) throw new TutorSyncError('ambiguous_name');
      return parsed.value;
    } catch (error) {
      metadata = null;
      throw error instanceof TutorSyncError ? error : new TutorSyncError('upstream');
    }
  }
  const resolver = username => {
    if (inFlight.has(username)) return inFlight.get(username);
    const promise = resolve(username).finally(() => inFlight.delete(username));
    inFlight.set(username, promise);
    return promise;
  };
  resolver.checkConfiguration = async () => {
    await getMetadata();
    return { connected: true, emailProperty: EMAIL_PROPERTY, tutorProperty: NAME_PROPERTY };
  };
  return resolver;
}

export function isExtensionSso(origin) { return origin === EXTENSION_ORIGIN; }

// Read-only diagnosis: never writes an account mapping or returns a tutor name.
export function createTutorStatusHandler({ db, resolveTutorName }) {
  return async c => {
    c.header('Cache-Control', 'no-store');
    if (c.get('user')?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(c.req.param('id'));
    if (!target || target.role !== 'crew') return c.json({ error: '対象のcrewアカウントがありません。' }, 404);
    try {
      const matched = (await resolveTutorName(target.username)) !== null;
      return c.json({ matched, reason: matched ? 'matched' : 'email_not_matched',
        message: matched ? '照合できました。権限・対応付けは変更していません。' : 'このユーザー名と完全一致するメールアドレスの有効な行がNotionにありません。大小文字・前後の空白・接続先を確認してください。' });
    } catch (error) {
      const safe = error instanceof TutorSyncError ? error : new TutorSyncError('upstream');
      return c.json({ matched: false, reason: safe.code, message: safe.message }, 503);
    }
  };
}

export function createTutorSyncHandler({ db, resolveTutorName }) {
  return async c => {
    if (c.get('user')?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    if (c.req.header('Origin') !== DASHBOARD_ORIGIN || c.req.header('X-WannaV-Request') !== '1') {
      return c.json({ error: '操作元を確認できません。' }, 403);
    }
    const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(c.req.param('id'));
    if (!target || target.role !== 'crew') return c.json({ error: '対象のcrewアカウントがありません。' }, 404);
    try {
      const tutorName = await resolveTutorName(target.username);
      const updated = db.prepare("UPDATE users SET tutor_name = ?, notion_tutor_approved = ? WHERE id = ? AND role = 'crew' AND username = ?")
        .run(tutorName, tutorName === null ? 0 : 1, target.id, target.username);
      if (updated.changes !== 1) return c.json({ error: 'アカウントが変更されました。開き直してください。' }, 409);
      c.header('Cache-Control', 'no-store');
      return c.json({ success: true, matched: tutorName !== null });
    } catch (error) {
      return c.json({ error: error instanceof TutorSyncError ? error.message : new TutorSyncError('upstream').message }, 503);
    }
  };
}

export function createTutorUnlinkHandler({ db }) {
  return c => {
    if (c.get('user')?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    if (c.req.header('Origin') !== DASHBOARD_ORIGIN || c.req.header('X-WannaV-Request') !== '1') return c.json({ error: '操作元を確認できません。' }, 403);
    db.prepare("UPDATE users SET tutor_name = NULL, notion_tutor_approved = 0 WHERE id = ? AND role = 'crew'").run(c.req.param('id'));
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true });
  };
}
