export const CATEGORIES_TO_EXCLUDE_FROM_LBC = [
  "Motos",
  "Vélos",
  "Voitures",
  "Consoles",
  "Jeux & Jouets",
  "Ventes immobilières",
  "Livres",
  "Équipement moto",
  "Équipement auto",
  "Sport & Plein air",
  "Bricolage",
  "Locations saisonnières",
  "Locations",
  "Électroménager",
  "Équipement caravaning",
  "Jeux vidéo",
  "Photo, audio & vidéo",
  "Consoles",
  "Montres & Bijoux",
  "Mobilier enfant",
  "Colocations",
  "Instruments de musique",
  "Tracteurs",
  "Animaux",
  "CD - Musique",
  "Caravaning",
  "Équipements pour restaurants & hôtels",
  "Poids lourds",
  "Modélisme",
  "Équipement nautisme",
  "Utilitaires",
  "Accessoires téléphone & Objets connectés",
  "Bureaux & Commerces",
  "Équipements vélos",
  "Équipements bébé",
  "Équipement bébé",
];

export const EXCLUDED_KEYWORDS = [
  // Vendu pour pièces
  "pour pièces",
  "pour pieces",
  "pièces détachées",
  "pieces detachees",
  "vendu pour pièces",
  "vendu pour pieces",
  "vendu comme pièces",
  "vendu comme pieces",
  // Grandes enseignes / marques de masse
  "Maisons du Monde",
  "Ikea",
  "Sklum",
  "Fly",
  "Redoute",
  "Conforama",
  "Leroy Merlin",
  "Castorama",
  "Brico Dépôt",
  "Alinéa",
  "Alinea",
  "Habitat",
  "Zara Home",
  "H&M Home",
  "Westwing",
  "Made.com",
  "Maison du Monde",
  // Copies / reproductions
  "copie",
  "réplique",
  "replique",
  "reproduction",
  "imitation",
  "inspiré de",
  "inspire de",
  "style scandinave",
  "style vintage",
  "style bohème",
  // Militaire / non-design
  "Militaire",
  "militaria",
  // Divers non pertinents
  "contemporain",
  "rachete",
  "rachète",
  "But ",
  "Gifi",
  "GIFI",
  // Plateformes spécialisées dans le titre = vendeur sait ce qu'il vend
  "1stDibs",
  "Selency",
  "Pamono",
];

// Example: 'Motos' -> 'motos'
// Example: 'Vélos' -> 'velos'
// Example: 'Voitures' -> 'voitures'
// Example: 'Consoles' -> 'consoles'
// Example: 'Jeux & Jouets' -> 'jeux_jouets'
// Example: 'Ventes immobilières' -> 'ventes_immobilieres'
// Example: 'Livres' -> 'livres'
// Example: 'Équipement moto' -> 'equipement_moto'
// Example: 'Équipement auto' -> 'equipement_auto'
export const CATEGORIES_SLUG_TO_EXCLUDE_FROM_LBC =
  CATEGORIES_TO_EXCLUDE_FROM_LBC.map((category) =>
    category
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[&,\-]/g, "")
      .replace(/\s+/g, "_")
      .toLowerCase(),
  );
