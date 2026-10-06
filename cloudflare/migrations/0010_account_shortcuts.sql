CREATE TABLE account_shortcuts (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('dm','player')),
 body TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY (user_id, role)
);
