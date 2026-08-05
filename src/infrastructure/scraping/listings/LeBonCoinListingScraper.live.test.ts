import { describe, it } from "vitest";
import { LeBonCoinListingScraper } from "./LeBonCoinListingScraper";

describe('LeBonCoinListingScraper', () => { 
    it('should scrape listings', async () => {
        const scraper = new LeBonCoinListingScraper()
        const listings = await scraper.search('https://www.leboncoin.fr/recherche?text=Maison+Jansen')
        console.log(listings)
    })
})