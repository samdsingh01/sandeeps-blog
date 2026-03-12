-- Allow public read access to keywords table
-- (keywords are not sensitive — this also fixes health check + any anon reads)
CREATE POLICY "Public can read keywords"
  ON keywords FOR SELECT
  USING (true);
