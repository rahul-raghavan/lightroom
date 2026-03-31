// Publisher name normalization for messy ERP data
// The Brand column has: "Not found", "Author / Publisher" combos, unicode artifacts,
// and inconsistent naming (Harper Collins vs HarperCollins)

export const PUBLISHER_ALIASES: Record<string, string> = {
  // HarperCollins variants
  'harper collins': 'HarperCollins',
  'harper collins india': 'HarperCollins',
  'harpercollins india': 'HarperCollins',
  'harpercollins publishers': 'HarperCollins',
  'harpercollins': 'HarperCollins',
  'harper perennial': 'HarperCollins',
  'harper design': 'HarperCollins',
  'harpersport': 'HarperCollins',
  "harpercollins children's books": 'HarperCollins',
  'fourth estate': 'HarperCollins',
  'william collins': 'HarperCollins',

  // Penguin Random House variants
  'penguin books': 'Penguin Random House',
  'penguin india': 'Penguin Random House',
  'penguin random house': 'Penguin Random House',
  'penguin random house india': 'Penguin Random House',
  'penguin': 'Penguin Random House',
  'random house': 'Penguin Random House',
  'random house india': 'Penguin Random House',
  'hamish hamilton': 'Penguin Random House',
  'viking': 'Penguin Random House',
  'dorling kindersley': 'Penguin Random House',
  'dk': 'Penguin Random House',
  'dk publishing': 'Penguin Random House',
  'puffin': 'Penguin Random House',
  'puffin books': 'Penguin Random House',
  'ladybird': 'Penguin Random House',
  'india puffin': 'Penguin Random House',
  'ebury press': 'Penguin Random House',
  'vintage': 'Penguin Random House',
  'vintage books': 'Penguin Random House',
  'vermilion': 'Penguin Random House',

  // Hachette variants
  'hachette': 'Hachette',
  'hachette india': 'Hachette',
  'hachette book publishing india': 'Hachette',
  'hachette book group': 'Hachette',
  'hodder & stoughton': 'Hachette',
  "hodder children's books": 'Hachette',
  "hachette children's": 'Hachette',
  'headline': 'Hachette',
  'little brown': 'Hachette',
  'little, brown': 'Hachette',
  'orion': 'Hachette',
  'orion publishing': 'Hachette',

  // Simon & Schuster
  'simon & schuster': 'Simon & Schuster',
  'simon and schuster': 'Simon & Schuster',
  'simon & schuster india': 'Simon & Schuster',
  'atria books': 'Simon & Schuster',
  'scribner': 'Simon & Schuster',

  // Pan Macmillan
  'pan macmillan': 'Pan Macmillan',
  'pan macmillan india': 'Pan Macmillan',
  'macmillan': 'Pan Macmillan',
  "macmillan children's books": 'Pan Macmillan',
  'picador': 'Pan Macmillan',
  'tor': 'Pan Macmillan',
  'bluebird': 'Pan Macmillan',

  // Scholastic
  'scholastic': 'Scholastic',
  'scholastic india': 'Scholastic',
  'graphix': 'Scholastic',
  'alison green books': 'Scholastic',

  // Oxford University Press
  'oxford university press': 'Oxford University Press',
  'oup': 'Oxford University Press',

  // Cambridge University Press
  'cambridge university press': 'Cambridge University Press',

  // Bloomsbury
  'bloomsbury': 'Bloomsbury',
  'bloomsbury india': 'Bloomsbury',
  'bloomsbury publishing': 'Bloomsbury',
  "bloomsbury children's books": 'Bloomsbury',
  'a&c black': 'Bloomsbury',

  // Rupa Publications
  'rupa': 'Rupa Publications',
  'rupa publications': 'Rupa Publications',
  'rupa publications india': 'Rupa Publications',

  // Westland / Amazon
  'westland': 'Westland',
  'westland publications': 'Westland',

  // Aleph Book Company
  'aleph book company': 'Aleph Book Company',
  'aleph': 'Aleph Book Company',
  'aleph book company private limited': 'Aleph Book Company',

  // Speaking Tiger
  'speaking tiger': 'Speaking Tiger',
  'speaking tiger books': 'Speaking Tiger',
  'speaking tiger books llp': 'Speaking Tiger',
  'speaking tiger books llp,': 'Speaking Tiger',
  'speaking tiger publishing ltd': 'Speaking Tiger',

  // Juggernaut
  'juggernaut': 'Juggernaut Books',
  'juggernaut books': 'Juggernaut Books',

  // Pratham Books
  'pratham books': 'Pratham Books',

  // National Book Trust
  'national book trust': 'National Book Trust',
  'nbt': 'National Book Trust',

  // Usborne
  'usborne': 'Usborne',
  'usborne publishing': 'Usborne',

  // Egmont
  'egmont': 'Egmont',
  'egmont books (uk)': 'Egmont',
  'egmont books': 'Egmont',
  'egmont books limited': 'Egmont',
  'egmont books, limited': 'Egmont',

  // Wiley
  'wiley': 'Wiley',
  'john wiley': 'Wiley',
  'john wiley & sons': 'Wiley',

  // Pearson
  'pearson': 'Pearson',
  'pearson education': 'Pearson',
  'pearson india': 'Pearson',

  // PHI / Prentice Hall
  'prentice hall': 'Pearson',
  'phi': 'Pearson',

  // S. Chand
  's chand': 'S. Chand',
  's. chand': 'S. Chand',

  // Tata McGraw Hill
  'tata mcgraw hill': 'McGraw Hill',
  'mcgraw hill': 'McGraw Hill',
  'mcgraw-hill': 'McGraw Hill',

  // Nosy Crow
  'nosy crow': 'Nosy Crow',
  'nosy crow limited': 'Nosy Crow',
  'nosy  crow': 'Nosy Crow',

  // Barrington Stoke
  'barrington stoke': 'Barrington Stoke',

  // Amar Chitra Katha
  'amar chitra katha': 'Amar Chitra Katha',
  'amar chitra katha private limited': 'Amar Chitra Katha',
  'amar chitra katha pvt': 'Amar Chitra Katha',
  'amar chitra katha pvt limited': 'Amar Chitra Katha',
  'amar chitra katha pvt ltd': 'Amar Chitra Katha',
  'amar chitra katha pvt. ltd.': 'Amar Chitra Katha',

  // Karadi Tales
  'karadi tales': 'Karadi Tales',
  'karadi tales picturebooks': 'Karadi Tales',
  'karadi': 'Karadi Tales',
  'kardai': 'Karadi Tales',

  // Duckbill Books
  'duckbill': 'Duckbill Books',
  'duckbill books': 'Duckbill Books',

  // Tulika
  'tulika': 'Tulika',
  'tulika publishers': 'Tulika',
  'tulika books': 'Tulika',

  // Eklavya
  'eklavya': 'Eklavya',
  'eklavya foundation': 'Eklavya',

  // Tara Books
  'tara': 'Tara Books',
  'tara books': 'Tara Books',
  'tara books pvt ltd': 'Tara Books',
  'tara books pvt. limited': 'Tara Books',
  'tara publishing': 'Tara Books',

  // Katha
  'katha': 'Katha',

  // Children's Book Trust
  "children's book trust": "Children's Book Trust",
  'cbt': "Children's Book Trust",

  // Tota Books
  'tota books': 'Tota Books',
  'tota book': 'Tota Books',

  // Kalpavriksh
  'kalpavriksh': 'Kalpavriksh',

  // Jyotsna Prakashan
  'jyotsna prakashan': 'Jyotsna Prakashan',

  // Red Panda
  'red panda': 'Red Panda',

  // Little Latitude
  'little latitude': 'Little Latitude',

  // Navakarnataka
  'navakarnataka': 'Navakarnataka',

  // Pickle Yolk Books
  'pickle yolk books': 'Pickle Yolk Books',

  // Navayana
  'navayana': 'Navayana',

  // Zubaan
  'zubaan': 'Zubaan',
  'zubaan books': 'Zubaan',
  'young zubaan': 'Young Zubaan',

  // Niyogi Books
  'niyogi': 'Niyogi Books',
  'niyogi books': 'Niyogi Books',

  // Seagull Books
  'seagullbook': 'Seagull Books',
  'seagull books': 'Seagull Books',
  'seagull books pvt ltd india': 'Seagull Books',
  'seagull books pvt ltd, india': 'Seagull Books',
  'seagull books pvt.ltd india': 'Seagull Books',
  'seagull books pvt.ltd ,india': 'Seagull Books',
  'seagull books pvt.ltd, india': 'Seagull Books',

  // Roli Books
  'roli': 'Roli Books',
  'roli book': 'Roli Books',
  'roli books': 'Roli Books',

  // Indagrow
  'indagrow': 'Indagrow',

  // Kyklada
  'kyklada': 'Kyklada',

  // Prism Books
  'prism books': 'Prism Books',

  // Kayfa
  'kayfa': 'Kayfa',
  'kayfa ta': 'Kayfa Ta',

  // Blaft
  'blaft': 'Blaft',
  'blaft publications pvt limited': 'Blaft',
  'blaft publications pvt. limited': 'Blaft',

  // Indian Stock Books misspellings
  'hacheete': 'Hachette',
  'rupapublication': 'Rupa Publications',
  'panmacmillan': 'Pan Macmillan',
  'randomhouse': 'Penguin Random House',
  'thamesandhudson': 'Thames & Hudson',

  // Jonathan Cape (PRH imprint)
  'jonathan cape': 'Penguin Random House',

  // Allen Lane (PRH imprint)
  'allen lane': 'Penguin Random House',

  // Frances Lincoln (old alias, now updated below)

  // Houghton Mifflin Harcourt
  'houghton mifflin harcourt': 'Houghton Mifflin Harcourt',
  'houghton mifflin': 'Houghton Mifflin Harcourt',

  // Little Simon (S&S imprint)
  'little simon': 'Simon & Schuster',
  'simon schuster': 'Simon & Schuster',

  // Harper Children's
  "harper children's": 'HarperCollins',
  'harper  collins': 'HarperCollins',
  'harpercollins uk': 'HarperCollins',

  // Abrams
  'abrams': 'Abrams',
  'abrams comicarts': 'Abrams',
  'abramas comicarts': 'Abrams',
  'abrams appleseed': 'Abrams',
  'harry n. abrams': 'Abrams',

  // Square Fish (Macmillan imprint)
  'square fish': 'Pan Macmillan',

  // Electric Monkey (Egmont imprint)
  'electric monkey': 'Egmont',

  // Wide Eyed Editions
  'wide eyed editions': 'Wide Eyed Editions',

  // Enchanted Lion
  'enchanted lion': 'Enchanted Lion Books',
  'enchanted lion books': 'Enchanted Lion Books',

  // Faber & Faber
  'faber': 'Faber & Faber',
  'faber & faber': 'Faber & Faber',
  "faber children's classics": 'Faber & Faber',

  // Walker Books
  'walker': 'Walker Books',
  'walker books': 'Walker Books',
  'walker studio': 'Walker Books',
  'baby walker': 'Walker Books',

  // Thames & Hudson
  'thames & hudson': 'Thames & Hudson',
  'thames and hudson': 'Thames & Hudson',

  // National Geographic
  'national geographic readers': 'National Geographic',
  'national geographic': 'National Geographic',

  // Candlewick
  'candlewick': 'Candlewick Press',
  'candlewick press': 'Candlewick Press',

  // Little Tiger
  'little tiger': 'Little Tiger',
  'little tiger kids': 'Little Tiger',

  // B Small
  'b small': 'B Small',

  // First Second (Macmillan imprint)
  'first second': 'Pan Macmillan',

  // Alma Classics
  'alma classics': 'Alma Classics',

  // Franklin Watts
  'franklin watts': 'Franklin Watts',

  // Ten Speed
  'tenspeed': 'Ten Speed Press',
  'ten speed graphic': 'Ten Speed Press',

  // Rebel Publisher
  'rebel publisher': 'Rebel Publisher',

  // Corgi (PRH imprint)
  'corgi childrens': 'Penguin Random House',

  // Picture Puffin / Penguin Classics / Penguin Enterprise etc
  'picture puffin': 'Penguin Random House',
  'penguin classics': 'Penguin Random House',
  'penguin enterprise': 'Penguin Random House',
  'penguin modern classics': 'Penguin Random House',
  'penguin uk': 'Penguin Random House',

  // Vintage Children's
  "vintage children's classics": 'Penguin Random House',

  // LB Kids (Hachette imprint)
  'lb kids': 'Hachette',

  // Two Hoots (Macmillan imprint)
  'two hoots': 'Pan Macmillan',

  // Red Shed
  'red shed': 'Penguin Random House',

  // Bloomsbury sub-imprints
  'bloomsbury education': 'Bloomsbury',
  'bloomsbury uk': 'Bloomsbury',
  'bloomsbury childrens': 'Bloomsbury',

  // Laurel Leaf (PRH imprint)
  'laurel leaf': 'Penguin Random House',

  // Aleph Book variants
  'aleph book': 'Aleph Book Company',

  // FingerPrint
  'fingerprint classics': 'FingerPrint Publishing',
  'fingerprint publishing': 'FingerPrint Publishing',

  // Talking Cub (Speaking Tiger imprint)
  'talking cub': 'Speaking Tiger',

  // Daisy / Parag / Happy Potato / other small Indian
  'happy yak': 'Happy Yak',
  'happy potato press': 'Happy Potato Press',
  'parag': 'Parag',

  // Magic Cat / Gibbs Smith / Little Dipper
  'magic cat': 'Magic Cat',
  'gibbs smith': 'Gibbs Smith',
  'the little dipper': 'The Little Dipper',
  'innovation press': 'Innovation Press',
  'innovation press, the': 'Innovation Press',
  'rebel girls': 'Rebel Girls',
  'little gestalten': 'Little Gestalten',
  'die gestalten verlag': 'Die Gestalten Verlag',
  'aladdin paperbacks': 'Simon & Schuster',
  'harper kids': 'HarperCollins',
  'kodansha america, incorporated': 'Kodansha America',
  'kodansha america, inc': 'Kodansha America',
  'kodansha usa': 'Kodansha America',
  'awwa pustaka': 'Awwa Pustaka',
  'gallup press': 'Gallup Press',
  'button books': 'Button Books',
  'people place project': 'People Place Project',
  'the people place project': 'People Place Project',

  // IBH
  'ibh': 'IBH',

  // Reliable
  'reliable': 'Reliable',

  // Hay House
  'hayhouse': 'Hay House',
  'hay house': 'Hay House',

  // Pelican (PRH imprint)
  'pelican': 'Penguin Random House',

  // Yoda Press
  'yoda': 'Yoda Press',

  // Granta
  'granta': 'Granta Books',
  'granta books': 'Granta Books',

  // Scholastic Inc
  'scholastic inc.': 'Scholastic',
  'scholastic inc': 'Scholastic',

  // Boynton Bookworks
  'boynton bookworks': 'Boynton Bookworks',

  // Daffdill Lane
  'daffdill lane': 'Daffdill Lane',

  // Tiny Owl Publishing
  'tiny owl': 'Tiny Owl Publishing',
  'tiny owl publishing': 'Tiny Owl Publishing',

  // Laurence King Publishing
  'laurence king': 'Laurence King Publishing',
  'laurence king publishing': 'Laurence King Publishing',

  // Flying Eye Books
  'flying eye': 'Flying Eye Books',
  'flying eye books': 'Flying Eye Books',

  // Sourcebooks
  'sourcebooks': 'Sourcebooks',
  'sourcebooks explore': 'Sourcebooks',
  'sourcebooks jabberwocky': 'Sourcebooks',

  // Hodder Paperbacks (Hachette imprint)
  'hodder paperbacks': 'Hachette',

  // Michael Joseph (PRH imprint)
  'michael joseph': 'Penguin Random House',

  // Clarkson Potter (PRH imprint)
  'clarkson potter': 'Penguin Random House',

  // Hidden Harmony (actual publisher)
  'hidden harmony': 'Hidden Harmony',

  // Ivy Kids (Quarto imprint)
  'ivy kids': 'Quarto',
  'ivy press': 'Quarto',
  'quarto': 'Quarto',
  'quarto kids': 'Quarto',
  'quartoknows': 'Quarto',
  'wide eyed': 'Quarto',

  // Frances Lincoln
  'france lincoln': "Frances Lincoln Children's Books",
  'frances lincoln': "Frances Lincoln Children's Books",
  'frances lincoln children': "Frances Lincoln Children's Books",
  "frances lincoln children's books": "Frances Lincoln Children's Books",
  'frances lincoln childrens books': "Frances Lincoln Children's Books",

  // Wonder House Books
  'wonder house books': 'Wonder House Books',
  'wonder house': 'Wonder House Books',

  // Deterministic legal suffix cleanup
  'chronicle books llc': 'Chronicle Books',
  'familius llc': 'Familius',
  'icon books limited': 'Icon Books',
  'picadilly press': 'Piccadilly Press',
  'piccadilly press limited': 'Piccadilly Press',
  'piccadilly press, limited': 'Piccadilly Press',
  'quadrille publishing limited': 'Quadrille Publishing',
  'quadrille publishing, limited': 'Quadrille Publishing',
  'weldon owen pty limited': 'Weldon Owen',
  'weldon owen pty, limited': 'Weldon Owen',
  'harivu creations pvt ltd': 'Harivu Creations',
  'harivu creations pvt. ltd': 'Harivu Creations',
  'art1st enterprise pvt ltd': 'Art1st',
  'art1st enterprise pvt. ltd': 'Art1st',
  'amar chitra katha, ack media': 'Amar Chitra Katha',
  'shikshan book and stationery pvt ltd': 'Shikshan Book and Stationery',
  'shikshan book and stationery pvt. ltd': 'Shikshan Book and Stationery',

  // Bodley Head (PRH imprint)
  'bodley head': 'Penguin Random House',
  'the bodley head': 'Penguin Random House',

  // Wren & Rook (Hachette imprint)
  'wren & rook': 'Hachette',
  'wren and rook': 'Hachette',

  // Transworld (PRH imprint)
  'transworld': 'Penguin Random House',

  // Hutchinson (PRH imprint)
  'hutchinson': 'Penguin Random House',

  // Piatkus (Hachette imprint)
  'piatkus': 'Hachette',

  // Century (PRH imprint)
  'century': 'Penguin Random House',

  // Harvill Secker (PRH imprint)
  'harvill secker': 'Penguin Random House',

  // Bantam (PRH imprint)
  'bantam': 'Penguin Random House',
  'bantam press': 'Penguin Random House',

  // Fig Tree (PRH imprint)
  'fig tree': 'Penguin Random House',

  // Chatto & Windus (PRH imprint)
  'chatto & windus': 'Penguin Random House',
  'chatto and windus': 'Penguin Random House',

  // Doubleday (PRH imprint)
  'doubleday': 'Penguin Random House',

  // Dedup aliases (name variations → canonical)
  'andersen': 'Andersen Press',
  'andersen press': 'Andersen Press',
  'andersen press (uk)': 'Andersen Press',
  'andrew mcmeel publishing': 'Andrews McMeel Publishing',
  'andrews mcmeel pub': 'Andrews McMeel Publishing',
  'andrews mcmeel publishing': 'Andrews McMeel Publishing',
  'anjana': 'Anjana Publishing',
  'anjana publishing': 'Anjana Publishing',
  'atom': 'Atom Books',
  'atom books': 'Atom Books',
  'b small publishing': 'B Small Publishing',
  'b small publisher': 'B Small Publishing',
  'balzer & bray': 'Balzer + Bray',
  'balzer + bray': 'Balzer + Bray',
  'balzer & bray/harperteen': 'Balzer + Bray',
  'barefoot books, limited': 'Barefoot Books',
  'black dog & leventhal pub': 'Black Dog & Leventhal',
  'boxtree, limited': 'Boxtree',
  'campbell': 'Campbell Books',
  'campbell books': 'Campbell Books',
  'candlewick press (ma)': 'Candlewick Press',
  'canongate': 'Canongate Books',
  'canongate books': 'Canongate Books',
  'canongate uk': 'Canongate Books',
  'cape jonathan childr': "Jonathan Cape Children's",
  'chicken house': 'Chicken House',
  'chicken house (english)': 'Chicken House',
  'chicken house ltd': 'Chicken House',
  'chicken house, the': 'Chicken House',
  "children's book trust,india": "Children's Book Trust",
  'cicada': 'Cicada Books',
  'cicada books': 'Cicada Books',
  'daff dil lane': 'Daffdill Lane',
  'die gestalten verlag-dgv': 'Die Gestalten Verlag',
  'dk children': 'DK',
  'dk publishing (dorling kindersley)': 'DK',
  'dorling kindersley publishing, incorporated': 'DK',
  'duckbill books & publications limited': 'Duckbill Books',
  'enchanted lion books, llc': 'Enchanted Lion Books',
  'farrar, straus & giroux (byr)': 'Farrar, Straus and Giroux',
  'farrar, straus and giroux (byr)': 'Farrar, Straus and Giroux',
  'fashore': 'Farshore',
  'farshore': 'Farshore',
  'five mile': 'Five Mile Press',
  'five mile press': 'Five Mile Press',
  'the five mile press pty ltd': 'Five Mile Press',
  'gecko': 'Gecko Press',
  'gecko press': 'Gecko Press',
  'hamlyn (uk)': 'Hamlyn',
  'katherine tegen': 'Katherine Tegen Books',
  'katherine tegen books': 'Katherine Tegen Books',
  'kids can press ltd': 'Kids Can Press',
  'kingfisher books limited': 'Kingfisher',
  'lonely planet global limited': 'Lonely Planet',
  'the museum of modern art': 'Museum of Modern Art',
  'phaidon press': 'Phaidon',
  'priddy': 'Priddy Books',
  'priddy books us': 'Priddy Books',
  'prh us': 'Penguin Random House',
  'pushkin press, limited': "Pushkin Children's Books",
  'roli b': 'Roli Books',
  'scholasitc': 'Scholastic',
  'silver dolphin': 'Silver Dolphin Books',
  'silver dolphin books': 'Silver Dolphin Books',
  'silver dolphinbooks': 'Silver Dolphin Books',
  'sounds true inc': 'Sounds True',
  "sterling children's books": 'Sterling Publishing',
  'sterling publishing company': 'Sterling Publishing',
  'sterling publishing company incorporated': 'Sterling Publishing',
  'storey publishing, llc': 'Storey Publishing',
  'templar': 'Templar Books',
  'templar books': 'Templar Books',
  'templar publishing': 'Templar Books',
  'thames & hudson, limited': 'Thames & Hudson',
  'viction:ary': 'Victionary',
  'virgin books limited': 'Virgin Books',
  'george weidenfeld & nicholson': 'Weidenfeld & Nicholson',
  'weidenfeld and nicholson': 'Weidenfeld & Nicholson',
  "welbeck children's books": 'Welbeck Publishing',
  'welbeck editions': 'Welbeck Publishing',
  'welbeck flame': 'Welbeck Publishing',
  'welbeck publishing group ltd.': 'Welbeck Publishing',
  'workman publishing company': 'Workman Publishing',
  'amistad press': 'Amistad',
  'alma books': 'Alma Classics',
};

// Substring-based matching for publishers that appear with varying prefixes
const SUBSTRING_RULES: [string, string][] = [
  ['penguin', 'Penguin Random House'],
  ['harpercollins', 'HarperCollins'],
  ['harper collins', 'HarperCollins'],
  ['hachette', 'Hachette'],
  ['scholastic', 'Scholastic'],
  ['bloomsbury', 'Bloomsbury'],
  ['macmillan', 'Pan Macmillan'],
  ['oxford university', 'Oxford University Press'],
  ['cambridge university', 'Cambridge University Press'],
  ['simon & schuster', 'Simon & Schuster'],
  ['simon and schuster', 'Simon & Schuster'],
  ['usborne', 'Usborne'],
  ['wiley', 'Wiley'],
  ['pearson', 'Pearson'],
  ['rupa', 'Rupa Publications'],
  ['pratham', 'Pratham Books'],
  ['karadi', 'Karadi Tales'],
  ['nosy crow', 'Nosy Crow'],
  ['barrington stoke', 'Barrington Stoke'],
  ['faber', 'Faber & Faber'],
  ['walker', 'Walker Books'],
  ['abrams', 'Abrams'],
  ['little tiger', 'Little Tiger'],
  ['national geographic', 'National Geographic'],
  ['fingerprint', 'FingerPrint Publishing'],
  ['wonder house', 'Wonder House Books'],
  ['sourcebooks', 'Sourcebooks'],
  ['quarto', 'Quarto'],
  ['tiny owl', 'Tiny Owl Publishing'],
  ['laurence king', 'Laurence King Publishing'],
  ['flying eye', 'Flying Eye Books'],
];

function stripUnicode(s: string): string {
  // Remove LTR marks, zero-width spaces, and other invisible unicode
  let cleaned = s.replace(/[\u200E\u200F\u200B\u200C\u200D\uFEFF]/g, '');
  // Decode common HTML entities (rawBrand sometimes has &amp;, &#39; etc.)
  cleaned = cleaned
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
  return cleaned.trim();
}

function isNotFound(s: string): boolean {
  const lower = s.toLowerCase().trim();
  return !lower || lower === 'not found' || lower === 'n/a' || lower === 'na' || lower === '-' || lower === 'none' || lower === 'null' || lower === 'undefined' || lower === 'unknown';
}

function stripAuthorPrefix(brand: string): string {
  // Remove "Author-" or "Author " prefix if present
  // e.g., "Author-Ruskin Bond" → "Ruskin Bond"
  return brand.replace(/^Author[-\s]+/i, '').trim();
}

function looksLikePersonName(s: string): boolean {
  // Heuristic: if it has initials (A. B.) or is short with 2-3 words and no
  // publisher-like keywords, it's probably a person name
  const trimmed = s.trim();

  // First check: if it's in our alias table, it's a known publisher, not a person
  if (PUBLISHER_ALIASES[trimmed.toLowerCase()]) return false;

  // Has initials like "A. A." or "J. K."
  if (/\b[A-Z]\.\s*[A-Z]\./.test(trimmed)) return true;
  // "FirstName LastName" pattern (2 words, both capitalized, no common publisher words)
  const words = trimmed.split(/\s+/);
  if (words.length === 2 || words.length === 3) {
    const publisherWords = ['books', 'publishing', 'press', 'publications', 'media', 'house', 'india', 'group', 'children', 'academic', 'international', 'university', 'tales', 'classics', 'editions'];
    const hasPublisherWord = words.some(w => publisherWords.includes(w.toLowerCase()));
    if (!hasPublisherWord && words.every(w => /^[A-Z]/.test(w))) {
      return true;
    }
  }
  return false;
}

function extractPublisher(brand: string): { publisher: string; isAuthorOnly: boolean } {
  // If the brand contains " / ", the last part is typically the publisher
  // e.g., "Author-Enid Blyton / Hodder Children's Books" → "Hodder Children's Books"
  if (brand.includes(' / ')) {
    const parts = brand.split(' / ');
    const publisher = parts[parts.length - 1].trim();
    return { publisher, isAuthorOnly: false };
  }

  // If it starts with "Author-" but has no " / ", the publisher lookup failed
  // e.g., "Author-Kingfisher" or "Author-Ruskin Bond" — just an author name
  if (/^Author[-\s]/i.test(brand)) {
    const stripped = stripAuthorPrefix(brand);
    return { publisher: stripped, isAuthorOnly: true };
  }

  return { publisher: brand.trim(), isAuthorOnly: false };
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map(word => {
      if (['and', 'of', 'the', 'in', 'for', 'to', 'a', 'an', '&'].includes(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    // Capitalize first word always
    .replace(/^./, c => c.toUpperCase());
}

export function getKnownPublishers(): string[] {
  const publishers = new Set(Object.values(PUBLISHER_ALIASES));
  return Array.from(publishers).sort();
}

export function isKnownPublisherAlias(rawBrand: string | null | undefined): boolean {
  if (!rawBrand) return false;

  const cleaned = stripUnicode(String(rawBrand)).trim().toLowerCase();
  if (!cleaned) return false;

  return Boolean(PUBLISHER_ALIASES[cleaned]);
}

export function cleanPublisherName(
  rawBrand: string | null | undefined,
  overrides?: Record<string, string>
): string {
  if (!rawBrand) return 'Unknown Publisher';

  // Step 0: Check user overrides first (case-insensitive on the raw brand)
  if (overrides) {
    const rawTrimmed = String(rawBrand).trim().toLowerCase();
    for (const [key, value] of Object.entries(overrides)) {
      if (key.toLowerCase() === rawTrimmed && value.trim()) {
        return value.trim();
      }
    }
  }

  // Step 1: Strip unicode artifacts
  let cleaned = stripUnicode(String(rawBrand));

  // Step 2: Check for "Not found" / empty / "Unknown"
  if (isNotFound(cleaned)) return 'Unknown Publisher';

  // Step 3: Extract publisher from "Author / Publisher" format
  const { publisher, isAuthorOnly } = extractPublisher(cleaned);
  cleaned = publisher;

  // Recheck after extraction
  if (isNotFound(cleaned)) return 'Unknown Publisher';

  // If the brand was "Author-X" with no slash, the publisher lookup failed in the ERP.
  // The remaining text is just the author name — mark as unknown UNLESS it matches
  // a known publisher alias (e.g., "Author-DK" → DK → Penguin Random House)
  const lowerCleaned = cleaned.toLowerCase().trim();

  // Step 4: Exact alias match (case-insensitive)
  if (PUBLISHER_ALIASES[lowerCleaned]) {
    return PUBLISHER_ALIASES[lowerCleaned];
  }

  // Step 5: Substring matching
  for (const [substring, publisherName] of SUBSTRING_RULES) {
    if (lowerCleaned.includes(substring)) {
      return publisherName;
    }
  }

  // If we know this was an author-only brand (had "Author-" prefix but no publisher),
  // and it didn't match any known publisher, it's just an author name
  if (isAuthorOnly) return 'Unknown Publisher';

  // Step 6: Check if the value looks like a person name rather than a publisher
  // This catches cases like "A. A. Milne" or "Ruskin Bond" that got into the Brand
  // column without an "Author-" prefix (data errors in the ERP)
  if (looksLikePersonName(cleaned)) return 'Unknown Publisher';

  // Step 7: Title-case anything not matched
  return toTitleCase(cleaned);
}
