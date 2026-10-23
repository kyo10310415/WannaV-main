import { readJwtSecret } from './security.js';

// Imported before db.js so missing configuration cannot initialize the DB.
export const JWT_SECRET = readJwtSecret(process.env);
