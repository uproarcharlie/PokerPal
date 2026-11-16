-- 0016_bank_transfer_clubs.sql
-- Round 8 (bank transfer payments): the bank account a club takes payments into ahead of a game.
-- - bank_account_name: the name on the account;
-- - bank_account_number: a New Zealand account number, stored as the banks write it
--   (00-0000-0000000-00 or -000; shared/api/clubs normaliseNzBankAccount, which the app validates);
-- - bank_name: the bank (optional);
-- - bank_instructions: the club's own short note for players paying by transfer (optional).
-- A club has bank details when it has both the name and the number. Staff only: only the club's
-- owner, its managers and admins read or write them (GET and PUT /api/clubs/:id/payments), and the one
-- other place they are sent is the answer to a sign-up for a tournament that shows them
-- (tournaments.show_bank_transfer, 0017), to whoever just signed up. No public read, the TV or a club
-- page ever carries them (shared/api/public BANK_DETAIL_KEYS, part of FORBIDDEN_PUBLIC_KEYS).
--
-- ADDITIVE + IDEMPOTENT ONLY: four nullable columns on clubs, no default, so every existing club reads
-- "no bank details" and nothing changes for it. No constraint is added. Re-running is a no-op.
--
-- Round 8 alters three tables, one file each (0016-0018, like 0010-0012): each ALTER takes ACCESS
-- EXCLUSIVE on its own table only, so no transaction holds one table's lock while it waits for
-- another's (P4REV3-PROD-01).
--
-- Deploy order: old code with this schema is fine (it never names these columns; its inserts leave
-- them NULL). New code needs them, which the boot applies before it listens.

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS bank_account_name text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS bank_account_number text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS bank_instructions text;
