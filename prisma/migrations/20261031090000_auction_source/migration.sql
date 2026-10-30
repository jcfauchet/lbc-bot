-- A second auction house joins the fund: auction lots are tagged AUCTION and
-- their house is read from auction_lots.house instead of the source column.
UPDATE "photo_references" SET "source" = 'AUCTION' WHERE "source" = 'ARTCURIAL';
