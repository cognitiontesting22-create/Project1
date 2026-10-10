-- Remember what the user actually typed for a split, not just the cents it
-- resolved to. Hundredths of the split's unit, as an integer:
--   percent -> basis points   (2500 = 25.00%, and all rows must sum to 10000)
--   shares  -> centishares    (150  = 1.5 shares)
--   equal / exact -> NULL, since amount_cents already is the input
ALTER TABLE expense_splits ADD COLUMN weight INTEGER;
