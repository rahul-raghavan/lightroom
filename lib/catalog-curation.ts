import {
  AgeGroup,
  BroadCategory,
  CatalogEntry,
  TagData,
} from './catalog-types';
import {
  sanitizeTagData,
  setCanonicalAuthor,
  setCanonicalPublisher,
} from './catalog-normalization';

interface PublisherOverride {
  matchPublisher?: string;
  resolvedPublisher: string;
  isbnPrefixes?: string[];
  exactIsbns?: string[];
  imprint?: string;
  parentPublisher?: string;
}

interface AuthorOverride {
  author: string;
  exactIsbns?: string[];
  pattern?: RegExp;
}

interface TagOverrideDefinition {
  ageGroup?: AgeGroup;
  categories?: BroadCategory[];
  subjects?: string[];
}

interface TitleTagOverride {
  pattern: RegExp;
  tags: TagOverrideDefinition;
}

function normalizeKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function hasUsefulTagData(entry: Pick<CatalogEntry, 'tagData'>): boolean {
  return Boolean(
    entry.tagData &&
    (
      entry.tagData.ageGroup ||
      entry.tagData.categories.length > 0 ||
      entry.tagData.subjects.length > 0
    )
  );
}

const CURATED_PUBLISHER_OVERRIDES: PublisherOverride[] = [
  { matchPublisher: 'Marion Billet / Listen to the', resolvedPublisher: 'Nosy Crow' },
  { matchPublisher: 'Joey Chou / Make and Play', resolvedPublisher: 'Nosy Crow' },
  { matchPublisher: 'John Patrick Green / InvestiGators!', resolvedPublisher: 'Pan Macmillan' },
  { matchPublisher: 'Hilde Lysiak / Hilde Cracks the Case', resolvedPublisher: 'Scholastic' },
  { matchPublisher: 'Author-Judy Blume / Fudge', resolvedPublisher: 'Pan Macmillan' },
  { matchPublisher: 'David Solomons / My Brother is a Superhero', resolvedPublisher: 'Nosy Crow' },
  { matchPublisher: 'Tim Wesson / Mega Mash-Up series', resolvedPublisher: 'Nosy Crow' },
  { matchPublisher: 'Manas Pratim Saikia Speaking Tiger Books Llp', resolvedPublisher: 'Speaking Tiger' },
  { matchPublisher: 'MANAS PRATIM SAIKIA SPEAKING TIGER BOOKS LLP', resolvedPublisher: 'Speaking Tiger' },
  { matchPublisher: 'Neeraj Jain Scholastic India Private Limited', resolvedPublisher: 'Scholastic' },
  { matchPublisher: 'Suzanne Singh Pratham Books', resolvedPublisher: 'Pratham Books' },
  { matchPublisher: 'Kapish Gautam Mehra Rupa Publications India Pvt. Ltd.', resolvedPublisher: 'Rupa Publications' },
  { matchPublisher: 'Author-Brian Floca / Atheneum', resolvedPublisher: 'Atheneum' },
  { matchPublisher: 'Author-Leonie Norrington / Allen & Unwin', resolvedPublisher: 'Allen & Unwin' },
  { matchPublisher: 'Ross Collins / 4u2read', resolvedPublisher: '4u2read' },
  { matchPublisher: 'Abraham Verghese / Grove Press UK', resolvedPublisher: 'Grove Press Uk' },
  { matchPublisher: 'Author-Isla Fisher / Marge', resolvedPublisher: 'Piccadilly Press' },
  { matchPublisher: 'Lemony Snicket / All The Wrong Questions', resolvedPublisher: 'Egmont' },
  { matchPublisher: 'Sam McBratney / Guess How Much I Love You', resolvedPublisher: 'Walker Books' },
  { matchPublisher: 'Author-Mo Willems / Elephant and Piggie', resolvedPublisher: 'Walker Books' },
  { matchPublisher: 'Elephant and Piggie', resolvedPublisher: 'Walker Books' },
  { matchPublisher: 'Author-Eileen Browne / Handa', resolvedPublisher: 'Walker Books' },
  { matchPublisher: 'Author-Polly Faber / Mango and Bambang', resolvedPublisher: 'Walker Books' },
  { matchPublisher: 'Zou Ingram / My First Book of', resolvedPublisher: 'Walker Books' },
  {
    matchPublisher: 'Dorling Kindersley / Conservation for Kids',
    resolvedPublisher: 'Dorling Kindersley',
    imprint: 'Dorling Kindersley',
    parentPublisher: 'Penguin Random House',
  },
  { matchPublisher: 'Andy Griffiths / Just', resolvedPublisher: 'Pan Macmillan' },
  { matchPublisher: 'Author-Devika Cariapa / India Focus', resolvedPublisher: 'Tulika' },
  { matchPublisher: 'Alice James / All You Need to Know by Age 7', resolvedPublisher: 'Usborne' },
  { matchPublisher: 'Barbara Mitchelhill / Eric', resolvedPublisher: 'Red Fox' },
  { matchPublisher: 'Richa Jha / Pickle', resolvedPublisher: 'Pickle Yolk Books' },
  {
    matchPublisher: 'Jess French / Beastlands',
    resolvedPublisher: 'Piccadilly Press',
    exactIsbns: ['9781800784062'],
    imprint: 'Piccadilly Press',
    parentPublisher: 'Bonnier Books UK',
  },
  {
    matchPublisher: 'Lavanya Karthik / Dreamers',
    resolvedPublisher: 'Kalpavriksh',
    exactIsbns: ['9788195697618', '9788187945864'],
  },
  {
    matchPublisher: 'Lavanya Karthik / Dreamers',
    resolvedPublisher: 'India Puffin',
    exactIsbns: ['9780143450498'],
    imprint: 'India Puffin',
    parentPublisher: 'Penguin Random House',
  },
  {
    matchPublisher: 'Lavanya Karthik / Dreamers',
    resolvedPublisher: 'Pratham Books',
    exactIsbns: ['9789354674150'],
  },
  {
    matchPublisher: 'Lavanya Karthik / Dreamers',
    resolvedPublisher: 'Karadi Tales',
    exactIsbns: ['9788193903322'],
  },
  {
    matchPublisher: 'Lavanya Karthik / Dreamers',
    resolvedPublisher: 'Ektara',
    exactIsbns: ['9789392873393'],
  },
  {
    matchPublisher: 'Lavanya Karthik / Dreamers',
    resolvedPublisher: 'Hook Books',
    exactIsbns: ['9780143458043'],
  },
  {
    matchPublisher: 'Lavanya Karthik / Dreamers',
    resolvedPublisher: 'Duckbill Books',
    exactIsbns: ['9780143464761', '9780143461562', '9780143461555', '9780143458418'],
  },
  {
    resolvedPublisher: 'Ektara',
    exactIsbns: [
      '9789384375775',
      '9789384375751',
      '9789384375690',
      '9789384375676',
      '9789384375669',
      '9789384375621',
      '9789384375522',
      '9789384375478',
      '9789384375461',
      '9789384375331',
      '9789384375324',
      '9789384375317',
      '9789384375270',
      '9789384375263',
    ],
  },
  {
    resolvedPublisher: 'Eklavya',
    exactIsbns: [
      '9789387926974',
      '9789387926493',
      '9789387926462',
      '9789387926417',
      '9789387926264',
      '9789387926257',
      '9789387926189',
      '9789387926127',
      '9789387926097',
    ],
  },
  {
    resolvedPublisher: 'Scholastic',
    exactIsbns: [
      '9789386041685',
      '9789386041326',
      '9789386041029',
      '9789386021595',
      '9789385874000',
      '9789385854279',
      '9789386050106',
      '9789386041005',
    ],
  },
  {
    resolvedPublisher: 'Bloomsbury',
    exactIsbns: [
      '9789384052430',
      '9789384030643',
    ],
  },
  {
    resolvedPublisher: 'Katha',
    exactIsbns: [
      '9788195068159',
      '9788195068142',
      '9788195068111',
    ],
  },
  {
    resolvedPublisher: 'Tulika',
    exactIsbns: [
      '9788188733637',
      '9788188733576',
    ],
  },
  {
    resolvedPublisher: 'Nosy Crow',
    exactIsbns: [
      '9781839947605',
      '9781839947612',
      '9781805130277',
      '9781839948442',
    ],
  },
  {
    resolvedPublisher: 'Quarto',
    exactIsbns: ['9781784937935'],
  },
  {
    resolvedPublisher: 'Anjana Publishing',
    exactIsbns: ['9789887905974', '9789887905912'],
  },
  {
    resolvedPublisher: 'Gallup Press',
    exactIsbns: ['9781595622396'],
  },
  {
    resolvedPublisher: 'Button Books',
    exactIsbns: ['9781787080591'],
  },
  {
    resolvedPublisher: 'People Place Project',
    exactIsbns: ['9783170858572'],
  },
];

const CURATED_AUTHOR_OVERRIDES: AuthorOverride[] = [
  {
    author: 'Maria Isabel Sanchez Vegara',
    exactIsbns: [
      '9780711286924',
      '9780711286900',
      '9780711248717',
      '9780711248670',
      '9780711286771',
      '9780711286788',
      '9780711286856',
      '9780711286948',
      '9780711248724',
      '9780711287037',
    ],
  },
  { author: 'Rebecca Harris', exactIsbns: ['9781837760541'] },
  { author: 'Lou Peacock', exactIsbns: ['9781805134312'] },
  { author: 'Jonathan Emmett', exactIsbns: ['9781805136125'] },
  { author: 'Jules Howard', exactIsbns: ['9781839943119'] },
  { author: 'Lucy George', exactIsbns: ['9781836003793'] },
  { author: 'Peter Wohlleben', exactIsbns: ['9780143473299'] },
  { author: 'Enid Blyton', exactIsbns: ['9781444955651', '9781444951080'] },
  { author: 'J. K. Rowling', exactIsbns: ['9781510202795'] },
  { author: 'Beatrix Potter', exactIsbns: ['9780241781548'] },
  { author: 'Rick Riordan', exactIsbns: ['9780241691717'] },
  { author: 'James Clear', exactIsbns: ['9781847941831'] },
  { author: 'William Dalrymple', exactIsbns: ['9781526656520'] },
  { author: 'Ingela P. Arrhenius, Kristin Atherton', exactIsbns: ['9781805134770'] },
  { author: 'Jules Howard', exactIsbns: ['9781839945533'] },
  { author: 'Lauren Fairgrieve', exactIsbns: ['9781805131045'] },
  { author: 'Hannah Alice', exactIsbns: ['9781839949401'] },
  { author: 'Nick Robinson', exactIsbns: ['9781839949449'] },
  { author: 'Gabby Dawnay', exactIsbns: ['9780500653630'] },
  { author: 'Yuval Zommer', exactIsbns: ['9780500421116'] },
  { author: 'Noelia Gonzalez', exactIsbns: ['9781915569455'] },
  { author: 'Ekaterina Trukhan', exactIsbns: ['9781839947605', '9781839947612', '9781805130277', '9781839948442'] },
  { author: 'Johnny Dyrander', exactIsbns: ['9781805133865'] },
];

const EXACT_TAG_OVERRIDES: Record<string, TagOverrideDefinition> = {
  '9780143473060': { categories: ['Religious'], subjects: ['Mary'] },
  '9781837265589': { categories: ['Fiction'] },
  '9788198894694': { categories: ['Art'], subjects: ['Magazine'] },
  '9788198894687': { categories: ['Art'], subjects: ['Magazine'] },
  '9788193166819': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9781913520311': { ageGroup: 'Middle Grade (8-12)', categories: ['Activity Book'], subjects: ['Baking'] },
  '9789354479991': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'], subjects: ['Food'] },
  '9781990252303': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction', 'Nature'], subjects: ['Animals'] },
  '9789395767545': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography', 'Education'], subjects: ['Inspiration'] },
  '9789334241006': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9781916180581': { categories: ['Fantasy'] },
  '9780500653111': { categories: ['Humor'] },
  '9780500653180': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Animals'] },
  '9781839133909': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789356402348': { categories: ['Nature'] },
  '9780143473268': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
  '9780241676998': { ageGroup: 'Young Adult (12-18)', categories: ['Fiction', 'Mystery'] },
  '9780143458456': { ageGroup: 'Middle Grade (8-12)', categories: ['Adventure', 'Fiction'] },
  '9788199048195': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9780241670873': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Mystery'] },
  '9780008614409': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Humor'] },
  '9781464280122': { ageGroup: 'Young Adult (12-18)', categories: ['Fiction'] },
  '9781464280139': { ageGroup: 'Young Adult (12-18)', categories: ['Fiction'] },
  '9788176212960': { categories: ['Cooking'] },
  '9789392130731': { categories: ['Cooking'] },
  '9789387509023': { ageGroup: 'Middle Grade (8-12)', categories: ['Art', 'Biography'], subjects: ['Raja Ravi Varma'] },
  '9789387509191': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography', 'Sports'], subjects: ['Dhyan Chand'] },
  '9789393987013': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography', 'Nature'], subjects: ['Salim Ali'] },
  '9789393987068': { ageGroup: 'Middle Grade (8-12)', categories: ['Art', 'Biography'], subjects: ['Amrita Shergil'] },
  '9789334132021': { categories: ['Education'], subjects: ['Cities'] },
  '9780143475828': { categories: ['Fiction'] },
  '9780143476436': { ageGroup: 'Young Adult (12-18)', categories: ['Self-Help'] },
  '9780143474319': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Water'] },
  '9780143471288': { ageGroup: 'Middle Grade (8-12)', categories: ['Adventure', 'Fiction'] },
  '9780143476795': { ageGroup: 'Picture Book (3-6)', categories: ['Biography', 'Religious'], subjects: ['Khadija'] },
  '9780143470182': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9780143472018': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Moon'] },
  '9780143457756': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9780143455370': { ageGroup: 'Middle Grade (8-12)', categories: ['Education', 'Nature'], subjects: ['India'] },
  '9780143453727': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Mystery'] },
  '9780143453178': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9780143450092': { ageGroup: 'Middle Grade (8-12)', categories: ['Education', 'History'], subjects: ['India'] },
  '9780143447337': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction', 'Nature'], subjects: ['Animals'] },
  '9780143445708': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9780143445258': { ageGroup: 'Middle Grade (8-12)', categories: ['Education', 'History'], subjects: ['India'] },
  '9780143468387': { ageGroup: 'Middle Grade (8-12)', categories: ['Art', 'Education'], subjects: ['India'] },
  '9780143460107': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
  '9780670094561': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Sea'] },
  '9780670091638': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9788195298013': { categories: ['Art'] },
  '9788197715181': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Horror'] },
  '9788199249400': { ageGroup: 'Middle Grade (8-12)', categories: ['Art', 'Education'] },
  '9788195439416': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction', 'Nature'], subjects: ['Animals'] },
  '9788189934613': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Animals'] },
  '9788119197255': { ageGroup: 'Picture Book (3-6)', categories: ['Humor'] },
  '9788123701592': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction', 'Nature'], subjects: ['Animals'] },
  '9789373073439': { categories: ['Horror'] },
  '9789388326803': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Mystery'] },
  '9789387926974': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
  '9789387509146': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789381337738': { ageGroup: 'Middle Grade (8-12)', categories: ['Education', 'Non-Fiction'] },
  '9789382474203': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789382454427': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789393396259': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Animals'] },
  '9789394552852': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Farm Animals'] },
  '9789392099694': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
  '9789353213121': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'], subjects: ['Food'] },
  '9789351034247': { ageGroup: 'Picture Book (3-6)', categories: ['Humor', 'Nature'], subjects: ['Animals'] },
  '9789350468494': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'] },
  '9789350466704': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Insects'] },
  '9789350220139': { ageGroup: 'Middle Grade (8-12)', categories: ['Education'] },
  '9789350225202': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789350222836': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789350226759': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'] },
  '9789354474811': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9780241637807': { ageGroup: 'Middle Grade (8-12)', categories: ['Adventure', 'Fiction'] },
  '9780241472934': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9780006546061': { ageGroup: 'Adult (18+)', categories: ['Fiction', 'Science'] },
  '9781595622396': { ageGroup: 'Middle Grade (8-12)', categories: ['Education', 'Self-Help'] },
  '9781913348991': { categories: ['Nature'], subjects: ['Seasons'] },
  '9781786587572': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
  '9788199440838': { categories: ['Fiction'] },
  '9788199440807': { categories: ['Fiction'] },
  '9788199440821': { categories: ['Fiction'] },
  '9788199440845': { categories: ['Fiction'] },
  '9789811428654': { categories: ['Activity Book', 'Art'], subjects: ['Activities'] },
  '9789348176967': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'] },
  '9789394552555': { ageGroup: 'Baby/Toddler (0-3)', categories: ['Board Book', 'Science'], subjects: ['Space'] },
  '9798897170821': { ageGroup: 'Middle Grade (8-12)', categories: ['Activity Book', 'Science'], subjects: ['Activities'] },
  '9788187945789': { categories: ['Humor'] },
  '9780143459781': { categories: ['Science'], subjects: ['Space'] },
  '9780711286887': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography'] },
  '9780711286849': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography'] },
  '9780711248700': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography'] },
  '9780711286788': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography'] },
  '9780711286924': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography'] },
  '9780711286900': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography'] },
  '9780711248717': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography'] },
  '9781839947605': { ageGroup: 'Baby/Toddler (0-3)', categories: ['Board Book', 'Nature'], subjects: ['Animals'] },
  '9781839947612': { ageGroup: 'Baby/Toddler (0-3)', categories: ['Board Book', 'Nature'], subjects: ['Animals'] },
  '9789350467664': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789393381606': { ageGroup: 'Picture Book (3-6)', categories: ['Activity Book', 'Art'], subjects: ['Activities'] },
  '9789393381910': { ageGroup: 'Picture Book (3-6)', categories: ['Activity Book', 'Art'], subjects: ['Activities'] },
  '9789395803007': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789395803441': { categories: ['Art', 'Nature', 'Poetry'] },
  '9789887905967': { ageGroup: 'Picture Book (3-6)', categories: ['Mythology', 'Religious'], subjects: ['Vishnu'] },
  '9788181469205': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9780143333135': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Sports'] },
  '9780143332039': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Sports'] },
  '9789388144209': { ageGroup: 'Baby/Toddler (0-3)', categories: ['Poetry'] },
  '9789390183869': { ageGroup: 'Baby/Toddler (0-3)', categories: ['Education'] },
  '9789390183906': { ageGroup: 'Baby/Toddler (0-3)', categories: ['Education'] },
  '9780241428139': { ageGroup: 'Middle Grade (8-12)', categories: ['Activity Book'] },
  '9780008791766': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9788196738723': { ageGroup: 'Middle Grade (8-12)', categories: ['Art'], subjects: ['Music'] },
  '9780552579247': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9789391790844': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction', 'Nature'], subjects: ['Animals'] },
  '9781838660130': { ageGroup: 'Adult (18+)', categories: ['Cooking'] },
  '9781510230491': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Insects'] },
  '9781914224102': { categories: ['Biography', 'Art'], subjects: ['Frida Kahlo'] },
  '9780241667828': { ageGroup: 'Middle Grade (8-12)', categories: ['History', 'Education'] },
  '9780143475095': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9780143469216': { ageGroup: 'Middle Grade (8-12)', categories: ['Adventure', 'Fiction'] },
  '9780143457763': { ageGroup: 'Middle Grade (8-12)', categories: ['Adventure', 'Fiction'] },
  '9780143465034': { categories: ['Fiction'] },
  '9780143466932': { categories: ['Fiction'] },
  '9780143450795': { categories: ['Fiction'] },
  '9780143452287': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9780143478300': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction'] },
  '9780143453185': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction', 'Nature'], subjects: ['Animals'] },
  '9789392130427': { categories: ['Cooking'] },
  '9781409565703': { ageGroup: 'Early Reader (5-8)', categories: ['Education'] },
  '9780571386611': { ageGroup: 'Adult (18+)', categories: ['Graphic Novel'] },
  '9789380636504': { categories: ['Graphic Novel', 'Nature'] },
  '9789083016177': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9780670085576': { categories: ['Fiction'] },
  '9780143467373': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9789352589760': { categories: ['Fiction'] },
  '9783170858572': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Water'] },
  '9781913520090': { ageGroup: 'Middle Grade (8-12)', categories: ['Science', 'Nature'], subjects: ['Ocean Life'] },
  '9781916180550': { ageGroup: 'Middle Grade (8-12)', categories: ['Adventure', 'Fiction'] },
  '9780143466550': { categories: ['Cooking'] },
  '9789354716874': { ageGroup: 'Early Reader (5-8)', categories: ['Education'] },
  '9789356806153': { categories: ['Fiction'] },
  '9781910593998': { ageGroup: 'Young Adult (12-18)', categories: ['Graphic Novel'] },
  '9789395767422': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography', 'Education'], subjects: ['Girls'] },
  '9781913520786': { ageGroup: 'Early Reader (5-8)', categories: ['Science', 'Nature'], subjects: ['Space'] },
  '9789393396143': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9780143448006': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
  '9781787335721': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
  '9780593796801': { ageGroup: 'Baby/Toddler (0-3)', categories: ['Board Book', 'Education'] },
  '9789380636979': { ageGroup: 'Adult (18+)', categories: ['Art'] },
  '9780143428794': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Nature'], subjects: ['Animals'] },
  '9789371973663': { ageGroup: 'Middle Grade (8-12)', categories: ['Biography', 'History'], subjects: ['Indira Gandhi'] },
  '9789887905981': { ageGroup: 'Picture Book (3-6)', categories: ['Religious'], subjects: ['Raksha Bandhan'] },
  '9780500653388': { ageGroup: 'Middle Grade (8-12)', categories: ['Art', 'Biography'], subjects: ['Vincent van Gogh'] },
  '9781779514332': { ageGroup: 'Young Adult (12-18)', categories: ['Graphic Novel', 'Fiction'] },
  '9781990252181': { ageGroup: 'Picture Book (3-6)', categories: ['Education', 'Nature'], subjects: ['Animals'] },
  '9780241714683': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction', 'Religious'], subjects: ['Christmas'] },
  '9788198734778': { ageGroup: 'Middle Grade (8-12)', categories: ['Education', 'History'], subjects: ['Jaipur'] },
  '9780241536452': { ageGroup: 'Middle Grade (8-12)', categories: ['Fiction', 'Mystery'] },
  '9789392130434': { categories: ['Cooking'] },
  '9781838660147': { ageGroup: 'Middle Grade (8-12)', categories: ['Art', 'Biography'], subjects: ['Yves Klein'] },
  '9781302932831': { ageGroup: 'Young Adult (12-18)', categories: ['Graphic Novel', 'Fiction'] },
  '9781302946630': { ageGroup: 'Young Adult (12-18)', categories: ['Graphic Novel', 'Fiction'] },
  '9780241656686': { ageGroup: 'Middle Grade (8-12)', categories: ['Science', 'Education'] },
  '9780571370221': { ageGroup: 'Middle Grade (8-12)', categories: ['Education', 'Religious'] },
  '9780241624814': { ageGroup: 'Middle Grade (8-12)', categories: ['Science', 'Nature'] },
  '9780500660300': { ageGroup: 'Picture Book (3-6)', categories: ['Nature'], subjects: ['Animals'] },
  '9780593569047': { ageGroup: 'Picture Book (3-6)', categories: ['Education'] },
  '9780500653821': { ageGroup: 'Picture Book (3-6)', categories: ['Art'] },
  '9780241563854': { ageGroup: 'Picture Book (3-6)', categories: ['Fiction'] },
  '9781405976206': { ageGroup: 'Adult (18+)', categories: ['Fiction'] },
};

const TITLE_TAG_OVERRIDES: TitleTagOverride[] = [
  {
    pattern: /\blittle people,\s*big dreams\b/i,
    tags: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Biography'],
    },
  },
  {
    pattern: /\batomic habits\b/i,
    tags: {
      ageGroup: 'Adult (18+)',
      categories: ['Self-Help'],
    },
  },
  {
    pattern: /\bmother mary\b/i,
    tags: {
      categories: ['Religious'],
      subjects: ['Mary'],
    },
  },
  {
    pattern: /\bpress out\b|\bdecorate\b|\bplay ?book\b/i,
    tags: {
      categories: ['Activity Book'],
      subjects: ['Activities'],
    },
  },
  {
    pattern: /\bghost\b/i,
    tags: {
      categories: ['Horror'],
    },
  },
  {
    pattern: /\bdragon\b/i,
    tags: {
      categories: ['Fantasy'],
    },
  },
  {
    pattern: /\bdiwali\b/i,
    tags: {
      categories: ['Religious'],
      subjects: ['Diwali'],
    },
  },
  {
    pattern: /\bpoop\b/i,
    tags: {
      categories: ['Humor'],
    },
  },
  {
    pattern: /\bengineering\b/i,
    tags: {
      categories: ['Science', 'Activity Book'],
      subjects: ['Activities'],
    },
  },
  {
    pattern: /^colors$/i,
    tags: {
      ageGroup: 'Baby/Toddler (0-3)',
      categories: ['Education'],
    },
  },
  {
    pattern: /^shapes$/i,
    tags: {
      ageGroup: 'Baby/Toddler (0-3)',
      categories: ['Education'],
    },
  },
  {
    pattern: /\bnursery rhymes?\b/i,
    tags: {
      ageGroup: 'Baby/Toddler (0-3)',
      categories: ['Poetry'],
    },
  },
  {
    pattern: /\bminecraft\b/i,
    tags: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Fiction'],
    },
  },
  {
    pattern: /\bbook of fun\b/i,
    tags: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Activity Book'],
      subjects: ['Activities'],
    },
  },
  {
    pattern: /\bfrida kahlo\b/i,
    tags: {
      categories: ['Biography', 'Art'],
      subjects: ['Frida Kahlo'],
    },
  },
  {
    pattern: /\bhello bugs\b/i,
    tags: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Nature'],
      subjects: ['Insects'],
    },
  },
  {
    pattern: /\bunstoppable us\b/i,
    tags: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['History', 'Education'],
    },
  },
  {
    pattern: /\bchaats?\b/i,
    tags: {
      categories: ['Cooking'],
    },
  },
  {
    pattern: /\bamma tell me about\b/i,
    tags: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Religious'],
    },
  },
  {
    pattern: /\bgreat lives in graphics\b/i,
    tags: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Biography'],
    },
  },
  {
    pattern: /\b(?:x-men|hulk|avengers|captain america|superman|robin vol\.?|blue lock|baby-sitters club graphix)\b/i,
    tags: {
      ageGroup: 'Young Adult (12-18)',
      categories: ['Graphic Novel', 'Fiction'],
    },
  },
  {
    pattern: /\bspot'?s\b/i,
    tags: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Fiction'],
    },
  },
  {
    pattern: /\b(?:dear vincent|yves klein)\b/i,
    tags: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Art', 'Biography'],
    },
  },
  {
    pattern: /\bindia street lettering\b/i,
    tags: {
      ageGroup: 'Adult (18+)',
      categories: ['Art'],
    },
  },
  {
    pattern: /\btechnol(?:g|og)y works\b/i,
    tags: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Science', 'Education'],
    },
  },
  {
    pattern: /\bthali\b/i,
    tags: {
      categories: ['Cooking'],
    },
  },
];

const PUBLISHER_AGE_DEFAULTS: Array<{ publisher: string; ageGroup: AgeGroup }> = [
  { publisher: 'Little Latitude', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Jyotsna Prakashan', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Daffdill Lane', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Adidev Press', ageGroup: 'Middle Grade (8-12)' },
  { publisher: 'Hook Books', ageGroup: 'Middle Grade (8-12)' },
  { publisher: 'Indagrow', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Art1st', ageGroup: 'Middle Grade (8-12)' },
  { publisher: 'Red Panda', ageGroup: 'Middle Grade (8-12)' },
  { publisher: 'Eklavya', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Kalpavriksh', ageGroup: 'Middle Grade (8-12)' },
  { publisher: 'Tota Books', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Pickle Yolk Books', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Press Out and Colour', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Ektara', ageGroup: 'Picture Book (3-6)' },
  { publisher: 'Parag', ageGroup: 'Picture Book (3-6)' },
];

function buildManualTagData(tags: TagOverrideDefinition, now: Date, confidence: TagData['confidence']): TagData | undefined {
  return sanitizeTagData({
    ageGroup: tags.ageGroup,
    categories: tags.categories || [],
    subjects: tags.subjects || [],
    source: 'manual',
    confidence,
    taggedAt: now.toISOString(),
  });
}

export function applyCuratedPublisherOverrides(entry: CatalogEntry): boolean {
  const override = CURATED_PUBLISHER_OVERRIDES.find(candidate => {
    if (candidate.matchPublisher && normalizeKey(candidate.matchPublisher) !== normalizeKey(entry.publisher)) {
      return false;
    }
    if (candidate.exactIsbns && !candidate.exactIsbns.includes(entry.isbn)) return false;
    if (candidate.isbnPrefixes && !candidate.isbnPrefixes.some(prefix => entry.isbn.startsWith(prefix))) return false;
    return true;
  });

  if (!override) return false;

  let changed = false;
  if (normalizeKey(entry.publisher) !== normalizeKey(override.resolvedPublisher)) {
    const result = setCanonicalPublisher(entry, override.resolvedPublisher, 'manual');
    changed = result.changed;
  }

  if (override.imprint && normalizeKey(entry.imprint) !== normalizeKey(override.imprint)) {
    entry.imprint = override.imprint;
    changed = true;
  }

  if (override.parentPublisher && normalizeKey(entry.parentPublisher) !== normalizeKey(override.parentPublisher)) {
    entry.parentPublisher = override.parentPublisher;
    changed = true;
  }

  return changed;
}

export function applyCuratedAuthorOverrides(entry: CatalogEntry): boolean {
  if (entry.author) return false;

  const override = CURATED_AUTHOR_OVERRIDES.find(candidate => (
    (candidate.exactIsbns && candidate.exactIsbns.includes(entry.isbn))
      || (candidate.pattern && candidate.pattern.test(entry.name))
  ));

  if (!override) return false;

  const changed = setCanonicalAuthor(entry, override.author, 'manual');
  if (changed) {
    entry.authorConfirmed = true;
  }

  return changed;
}

export function applyCuratedTagOverrides(entry: CatalogEntry, now = new Date()): boolean {
  if (hasUsefulTagData(entry)) return false;

  const exactOverride = EXACT_TAG_OVERRIDES[entry.isbn];
  if (exactOverride) {
    const tagData = buildManualTagData(exactOverride, now, 'high');
    if (!tagData) return false;
    entry.tagData = tagData;
    entry.tagsConfirmed = true;
    return true;
  }

  const titleOverride = TITLE_TAG_OVERRIDES.find(candidate => candidate.pattern.test(entry.name));
  if (titleOverride) {
    const tagData = buildManualTagData(titleOverride.tags, now, 'high');
    if (!tagData) return false;
    entry.tagData = tagData;
    entry.tagsConfirmed = true;
    return true;
  }

  const publisherDefault = PUBLISHER_AGE_DEFAULTS.find(candidate => normalizeKey(candidate.publisher) === normalizeKey(entry.publisher));
  if (!publisherDefault) return false;

  const tagData = buildManualTagData({ ageGroup: publisherDefault.ageGroup }, now, 'low');
  if (!tagData) return false;
  entry.tagData = tagData;
  return true;
}
