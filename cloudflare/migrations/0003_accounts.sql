create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");
CREATE TABLE library_members (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 code TEXT NOT NULL, seat_id TEXT NOT NULL, token TEXT NOT NULL,
 name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,code), UNIQUE(code,seat_id)
);
CREATE TABLE library_backups (
 id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 name TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX library_backups_owner ON library_backups(user_id,created_at);
CREATE TABLE library_characters (
 id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(id,user_id)
);
CREATE TABLE library_recovery (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, key_hash TEXT NOT NULL
);
CREATE TABLE library_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, hits INTEGER NOT NULL);
