const ADJECTIVES = [
  "Amber", "Arctic", "Azure", "Bold", "Bright", "Calm", "Cerulean", "Cobalt",
  "Coral", "Crimson", "Crystal", "Dark", "Dusk", "Emerald", "Fast", "Fern",
  "Frosty", "Gold", "Grand", "Green", "Hazy", "Indigo", "Iron", "Ivory",
  "Jade", "Just", "Keen", "Lavender", "Lime", "Lush", "Mauve", "Midnight",
  "Mild", "Misty", "Moss", "Neat", "Noble", "Ocean", "Olive", "Open",
  "Orange", "Pale", "Pearl", "Pine", "Pink", "Plum", "Polar", "Quick",
  "Rare", "Rose", "Royal", "Ruby", "Rust", "Sage", "Sandy", "Scarlet",
  "Silver", "Sky", "Slate", "Solar", "Swift", "Teal", "Terra", "Tidal",
  "Topaz", "Unit", "Umber", "Vast", "Velvet", "Violet", "Warm", "Wild",
  "Windy", "Zinc",
];

const ANIMALS = [
  "Albatross", "Alpaca", "Badger", "Bear", "Beaver", "Bison", "Buffalo", "Capybara",
  "Cheetah", "Condor", "Crane", "Crow", "Deer", "Dolphin", "Eagle", "Elk",
  "Falcon", "Ferret", "Finch", "Fisher", "Flamingo", "Fox", "Gecko", "Gibbon",
  "Giraffe", "Gorilla", "Heron", "Horse", "Iguana", "Jaguar", "Jay", "Koala",
  "Lemur", "Leopard", "Llama", "Lynx", "Marmot", "Mink", "Moose", "Newt",
  "Osprey", "Otter", "Owl", "Panda", "Parrot", "Pelican", "Penguin", "Puma",
  "Quail", "Raven", "Salamander", "Seal", "Sloth", "Sparrow", "Stag", "Starling",
  "Swan", "Tapir", "Tiger", "Toucan", "Vole", "Weasel", "Wolf", "Wolverine",
  "Wombat", "Wren", "Yak", "Zebra",
];

export function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

// Binary space-filling hue wheel: maximally-distinct colors
const HUE_ORDER = [0, 180, 90, 270, 45, 225, 135, 315];

export function hueToHex(hue: number): string {
  const s = 0.7;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 60)       { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else                { r = c; g = 0; b = x; }

  const toHex = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function colorForPeerIndex(index: number): string {
  return hueToHex(HUE_ORDER[index % HUE_ORDER.length]);
}
