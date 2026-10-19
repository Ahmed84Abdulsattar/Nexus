import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The db/ folder. Works from src/admin (scripts, tests) and dist/admin (built). */
export const DB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const MIGRATIONS_DIR = `${DB_ROOT}migrations`;
export const SEEDS_DIR = `${DB_ROOT}seeds`;
export const SCHEMA_FILE = `${DB_ROOT}schema.sql`;
export const ROLES_FILE = `${DB_ROOT}roles.sql`;

export const readSql = (file: string): string => readFileSync(file, 'utf8');
