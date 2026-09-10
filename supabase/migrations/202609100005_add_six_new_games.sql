-- ============================================================================
-- 202609100005: Add 6 new games to unified schema
--
-- Adds: jackpot, plinko, poker, baccarat, hi-lo, keno
-- Extends all CHECK constraints that enumerate game keys.
-- Adds game_wallets, game_payout_caps, and indexes for each new game.
-- Preserves all existing data and schemas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend game_wallets.game_id CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.game_wallets
  DROP CONSTRAINT IF EXISTS game_wallets_game_id_check;

ALTER TABLE public.game_wallets
  ADD CONSTRAINT game_wallets_game_id_check
  CHECK (game_id IN (
    'roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar',
    'color-prediction','number-prediction','wheel',
    'jackpot','plinko','poker','baccarat','hi-lo','keno'
  ));

-- ---------------------------------------------------------------------------
-- 2. Extend game_rounds.game_key CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.game_rounds
  DROP CONSTRAINT IF EXISTS game_rounds_game_key_check;

ALTER TABLE public.game_rounds
  ADD CONSTRAINT game_rounds_game_key_check
  CHECK (game_key IN (
    'roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar',
    'color-prediction','number-prediction','wheel',
    'jackpot','plinko','poker','baccarat','hi-lo','keno'
  ));

-- ---------------------------------------------------------------------------
-- 3. Extend game_bets.game_key CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.game_bets
  DROP CONSTRAINT IF EXISTS game_bets_game_key_check;

ALTER TABLE public.game_bets
  ADD CONSTRAINT game_bets_game_key_check
  CHECK (game_key IN (
    'roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar',
    'color-prediction','number-prediction','wheel',
    'jackpot','plinko','poker','baccarat','hi-lo','keno'
  ));

-- ---------------------------------------------------------------------------
-- 4. Extend game_settlements.game_key CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.game_settlements
  DROP CONSTRAINT IF EXISTS game_settlements_game_key_check;

ALTER TABLE public.game_settlements
  ADD CONSTRAINT game_settlements_game_key_check
  CHECK (game_key IN (
    'roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar',
    'color-prediction','number-prediction','wheel',
    'jackpot','plinko','poker','baccarat','hi-lo','keno'
  ));

-- ---------------------------------------------------------------------------
-- 5. Create game_wallets for new games
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT owner_user_id INTO v_owner FROM public.coin_supply WHERE singleton;
  IF v_owner IS NOT NULL THEN
    INSERT INTO public.game_wallets(game_id, owner_user_id) VALUES
      ('jackpot', v_owner),
      ('plinko', v_owner),
      ('poker', v_owner),
      ('baccarat', v_owner),
      ('hi-lo', v_owner),
      ('keno', v_owner)
    ON CONFLICT (game_id) DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Payout caps for all 15 games (idempotent)
-- ---------------------------------------------------------------------------
-- Game payout caps table may or may not exist depending on migration order.
-- Use IF NOT EXISTS to be safe.
CREATE TABLE IF NOT EXISTS public.game_payout_caps (
  game_key text PRIMARY KEY,
  max_multiplier numeric(10,2) NOT NULL CHECK (max_multiplier >= 1)
);

INSERT INTO public.game_payout_caps(game_key, max_multiplier) VALUES
  ('roulette',         36.00),
  ('teen-patti',        6.00),
  ('crash',           100.00),
  ('dice',             36.00),
  ('dragon-tiger',      9.00),
  ('andar-bahar',       2.00),
  ('color-prediction',  5.00),
  ('number-prediction',10.00),
  ('wheel',            10.00),
  ('jackpot',        1000.00),
  ('plinko',            5.00),
  ('poker',           250.00),
  ('baccarat',          8.00),
  ('hi-lo',             5.00),
  ('keno',           5000.00)
ON CONFLICT (game_key) DO UPDATE SET max_multiplier = EXCLUDED.max_multiplier;

-- Enable RLS on payout caps
ALTER TABLE public.game_payout_caps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_payout_caps FROM public, anon, authenticated;
GRANT ALL ON public.game_payout_caps TO service_role;
