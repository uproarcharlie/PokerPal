import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";
import crypto from "crypto";

const PgStore = connectPgSimple(session);

// Generate or use session secret
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET not set in .env, using random generated secret (sessions will reset on server restart)');
}

export const sessionConfig = {
  store: new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'lax' as const,
  },
  name: 'pokerpal.sid', // Custom session ID name
};

// Extend express-session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
    role: string;
  }
}
