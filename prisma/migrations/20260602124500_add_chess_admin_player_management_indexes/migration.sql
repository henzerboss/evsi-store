-- Extra lightweight indexes for Chess Pro player moderation/search in admin.
-- These do not alter or delete any data.

CREATE INDEX IF NOT EXISTS "idx_chess_player_nickname" ON "ChessPlayer"("nickname");
CREATE INDEX IF NOT EXISTS "idx_chess_player_updatedAt" ON "ChessPlayer"("updatedAt");
CREATE INDEX IF NOT EXISTS "idx_chess_player_lastWinAt" ON "ChessPlayer"("lastWinAt");
