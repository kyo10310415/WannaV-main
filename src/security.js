const ROLES = new Set(['admin', 'leader', 'crew']);

export function readJwtSecret(env) {
  const secret = env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 32 ||
      /change-in-production|your[-_]?(shared[-_]?)?secret/i.test(secret)) {
    throw new Error('JWT_SECRET must be configured with a strong secret of at least 32 characters');
  }
  return secret;
}

export function canCreateUser(actor, role) {
  return ROLES.has(role) && (actor?.role === 'admin' || (actor?.role === 'leader' && role === 'crew'));
}

export function canManageUser(actor, target) {
  return !!target && ROLES.has(target.role) &&
    (actor?.role === 'admin' || (actor?.role === 'leader' && target.role === 'crew'));
}
