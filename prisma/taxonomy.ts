export const TAXONOMY = {
  CATEGORIES: [
    'table_basse',
    'table_repas',
    'chaise',
    'fauteuil',
    'canapé',
    'enfilade',
    'commode',
    'bibliothèque',
    'bureau',
    'lampe_de_table',
    'lampadaire',
    'suspension',
    'applique',
    'miroir',
    'objet_déco',
  ],
  PERIODS: [
    'avant_1900',
    '1900_1918',      // art nouveau, début modernisme
    '1919_1939',      // art déco, Bauhaus, modernisme interguerre
    '1940_1959',      // mid-century early
    '1960_1979',      // mid-century tardif, space age, pop
    '1980_1999',      // postmoderne, eighties/nineties
    '2000_present',   // design contemporain
  ],
  MATERIALS: [
    'bois',
    'teck',
    'palissandre',
    'chêne',
    'noyer',
    'acajou',
    'pin',
    'métal',
    'acier',
    'chrome',
    'laiton',
    'aluminium',
    'fer_forgé',
    'verre',
    'marbre',
    'travertin',
    'céramique',
    'cuir',
    'tissu',
    'velours',
    'plastique',
    'rotin',
    'osier'
  ],
  STYLES: [
    'classique',
    'art_nouveau',
    'art_deco',
    'bauhaus',
    'modernisme',
    'mid_century_modern',
    'space_age',
    'hollywood_regency',
    'post_moderne',
    'industriel',
    'scandinave',
    'campagne',
    'rustique',
    'boheme',
    'minimaliste',
    'contemporain',
  ]
} as const;

export type TaxonomyCategory = typeof TAXONOMY.CATEGORIES[number];
export type TaxonomyPeriod = typeof TAXONOMY.PERIODS[number];
export type TaxonomyMaterial = typeof TAXONOMY.MATERIALS[number];
export type TaxonomyStyle = typeof TAXONOMY.STYLES[number];
