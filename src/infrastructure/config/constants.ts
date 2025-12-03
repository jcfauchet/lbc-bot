export const CATEGORIES_TO_EXCLUDE_FROM_LBC = [
  'Motos',
  'Vélos',
  'Voitures',
  'Consoles',
  'Jeux & Jouets',
  'Ventes immobilières',
  'Livres',
  'Équipement moto',
  'Équipement auto',
  'Sport & Plein air', 
  'Bricolage',
  'Locations saisonnières',
  'Locations',
  'Électroménager',
  'Équipement caravaning',
  'Jeux vidéo',
  'Photo, audio & vidéo',
  'Consoles',
  'Montres & Bijoux',
  'Mobilier enfant',
  'Colocations',
  'Instruments de musique',
  'Tracteurs',
  'Animaux',
  'CD - Musique'
]

// Example: 'Motos' -> 'motos'
// Example: 'Vélos' -> 'velos'
// Example: 'Voitures' -> 'voitures'
// Example: 'Consoles' -> 'consoles'
// Example: 'Jeux & Jouets' -> 'jeux_jouets'
// Example: 'Ventes immobilières' -> 'ventes_immobilieres'
// Example: 'Livres' -> 'livres'
// Example: 'Équipement moto' -> 'equipement_moto'
// Example: 'Équipement auto' -> 'equipement_auto'
export const CATEGORIES_SLUG_TO_EXCLUDE_FROM_LBC = CATEGORIES_TO_EXCLUDE_FROM_LBC.map(
  (category) =>
    category
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[&,\-]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase()
)