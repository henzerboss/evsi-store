-- Extra read indexes for the Chess Pro admin dashboard.
-- They do not change data and make recent activity / latest podium widgets cheap.
CREATE INDEX IF NOT EXISTS "ChessPlayer_createdAt_idx" ON "ChessPlayer"("createdAt");
CREATE INDEX IF NOT EXISTS "ChessWinEvent_createdAt_idx" ON "ChessWinEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "ChessWinEvent_countryCode_createdAt_idx" ON "ChessWinEvent"("countryCode", "createdAt");
CREATE INDEX IF NOT EXISTS "ChessChampionshipPodiumAward_createdAt_idx" ON "ChessChampionshipPodiumAward"("createdAt");
CREATE INDEX IF NOT EXISTS "ChessChampionshipPodiumAward_finalizedAt_idx" ON "ChessChampionshipPodiumAward"("finalizedAt");
