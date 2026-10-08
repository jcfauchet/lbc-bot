-- Words that, found in an ad's text, send it to the verifier regardless of photo similarity.
ALTER TABLE "photo_references" ADD COLUMN "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Seed the references created before keywords existed from the designer in their name.
UPDATE "photo_references" SET "keywords" = ARRAY['chapo'] WHERE "name" ILIKE '%chapo%';
UPDATE "photo_references" SET "keywords" = ARRAY['brusotti'] WHERE "name" ILIKE '%brusotti%';
UPDATE "photo_references" SET "keywords" = ARRAY['jansen'] WHERE "name" ILIKE '%jansen%';
