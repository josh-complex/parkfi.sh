-- SFWMD ERP adapter (public-records plan §5.6, built 2026-09-12): applicant
-- spellings the District's feed uses that the seed aliases miss. Patterns
-- match `filer_norm` (upper-cased, punctuation stripped, legal suffixes
-- dropped), so "Walt Disney Parks & Resorts, US, Inc" is
-- "WALT DISNEY PARKS RESORTS US" — no "AND" — and needs its own prefix.
INSERT INTO public_record_filer_alias (pattern, operator, resort_slug) VALUES
  ('WALT DISNEY PARKS%', 'disney', NULL),
  ('FLAMINGO CROSSINGS%', 'disney', 'walt-disney-world'),
  ('UNIVERSAL CITY DEVELPMENT%', 'universal', 'universal-orlando')
ON CONFLICT (pattern) DO NOTHING;
