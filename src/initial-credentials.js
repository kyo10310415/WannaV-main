import { randomBytes } from 'node:crypto';

export const MIN_INITIAL_PASSWORD_LENGTH = 16;
export function createInitialPassword() {
  return randomBytes(24).toString('base64url');
}
// Only pending first-use credentials are affected; established accounts keep their login contract.
export function requiresInitialCredentialReissue(user, password) {
  return !!user?.must_change_password && typeof password === 'string'
    && password.length < MIN_INITIAL_PASSWORD_LENGTH;
}
export function initialCredentialSessionAllowed(user, claims) {
  return !user?.must_change_password || claims?.initialCredential === true;
}
