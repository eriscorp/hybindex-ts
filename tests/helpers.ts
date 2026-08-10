import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

/**
 * Create a temp world root with the expected layout:
 *   <tmp>/world/xml/<type>/*.xml
 *   <tmp>/world/.creidhne/
 *   <tmp>/world/scripts/
 * Returns the path to the xml dir (i.e. the libraryPath callers would use).
 */
export async function makeWorldTemp(): Promise<{ libraryPath: string; root: string }> {
  const root = await fs.mkdtemp(join(tmpdir(), 'hybindex-test-'));
  const libraryPath = join(root, 'world', 'xml');
  await fs.mkdir(libraryPath, { recursive: true });
  await fs.mkdir(join(root, 'world', '.creidhne'), { recursive: true });
  await fs.mkdir(join(root, 'world', 'scripts'), { recursive: true });
  return { libraryPath, root };
}

/** `relPath` may name a subdirectory (`fire/blast.xml`), not just a filename. */
export async function writeXml(
  libraryPath: string,
  type: string,
  relPath: string,
  content: string,
): Promise<void> {
  const full = join(libraryPath, type, relPath);
  await fs.mkdir(dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

export async function writeArchivedXml(
  libraryPath: string,
  type: string,
  relPath: string,
  content: string,
): Promise<void> {
  return writeXml(libraryPath, type, join('.ignore', relPath), content);
}

export async function writeLua(libraryPath: string, relPath: string, content: string): Promise<void> {
  const scriptsDir = join(libraryPath, '..', 'scripts');
  const full = join(scriptsDir, relPath);
  await fs.mkdir(join(full, '..'), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

export async function cleanup(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

// ── Sample XML builders ─────────────────────────────────────────────────────

export const castableXml = (
  name: string,
  opts: {
    class?: string;
    icon?: number;
    healFormulaName?: string;
    damageFormulaName?: string;
    categories?: string[];
  } = {},
): string => {
  const metaBits: Record<string, unknown> = {};
  if (opts.healFormulaName) metaBits.healFormulaName = opts.healFormulaName;
  if (opts.damageFormulaName) metaBits.damageFormulaName = opts.damageFormulaName;
  const metaComment = Object.keys(metaBits).length
    ? `\n  <!-- creidhne:meta ${JSON.stringify(metaBits)} -->`
    : '';
  const categories = opts.categories?.length
    ? `\n  <Categories>${opts.categories.map((c) => `<Category>${c}</Category>`).join('')}</Categories>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<Castable xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02"
          Book="PrimarySpell" Elements="Fire"
          Class="${opts.class ?? 'Wizard'}"
          ${opts.icon ? `Icon="${opts.icon}"` : ''}
          IsAssail="false" Reflectable="false" BreakStealth="false"
          IncludeInMetafile="true" PvpOnly="false">${metaComment}
  <Name>${name}</Name>${categories}
</Castable>`;
};

export const statusXmlWithMeta = (name: string, formulaNames: Record<string, { heal?: string; damage?: string }>): string => {
  const meta = JSON.stringify({ formulaNames });
  return `<?xml version="1.0" encoding="utf-8"?>
<Status xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}" Icon="1" Duration="5" Tick="1">
  <!-- creidhne:meta ${meta} -->
</Status>`;
};

export const statusXml = (name: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Status xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}" Icon="1" Duration="5" Tick="1"/>`;

export const itemXml = (
  name: string,
  opts: {
    shopTab?: string;
    category?: string;
    /** LargeMin/LargeMax are optional in the schema, so they are optional here. */
    damage?: { smallMin: number; smallMax: number; largeMin?: number; largeMax?: number };
    /** Write `<Damage …></Damage>` instead of the self-closing form. */
    pairedDamage?: boolean;
  } = {},
): string => {
  const damageAttrs = opts.damage
    ? [
        `SmallMin="${opts.damage.smallMin}"`,
        `SmallMax="${opts.damage.smallMax}"`,
        ...(opts.damage.largeMin != null ? [`LargeMin="${opts.damage.largeMin}"`] : []),
        ...(opts.damage.largeMax != null ? [`LargeMax="${opts.damage.largeMax}"`] : []),
      ].join(' ')
    : '';
  const dmg = !opts.damage
    ? ''
    : opts.pairedDamage
      ? `<Damage ${damageAttrs}></Damage>`
      : `<Damage ${damageAttrs}/>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<Item xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02">
  <Name>${name}</Name>
  <Properties>
    ${opts.shopTab ? `<Vendor ShopTab="${opts.shopTab}"/>` : ''}
    ${opts.category ? `<Categories><Category>${opts.category}</Category></Categories>` : ''}
    ${dmg}
  </Properties>
</Item>`;
};

export const castableXmlWithRequirement = (name: string, levelMin: number, charClass = 'Warrior'): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Castable xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02"
          Book="PrimarySpell" Elements="Fire" Class="${charClass}"
          IsAssail="false" Reflectable="false" BreakStealth="false"
          IncludeInMetafile="true" PvpOnly="false">
  <Name>${name}</Name>
  <Requirements>
    <Requirement Class="${charClass}">
      <Level Min="${levelMin}" Max="99"/>
    </Requirement>
  </Requirements>
</Castable>`;

export const creatureXml = (name: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Creature xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}" Sprite="100"/>`;

export const npcXml = (name: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Npc xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02">
  <Name>${name}</Name>
</Npc>`;

export const localizationXml = (locale: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Localization xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Locale="${locale}"/>`;

export const mapXml = (name: string, id: number, x: number, y: number): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Map xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Id="${id}" X="${x}" Y="${y}">
  <Name>${name}</Name>
</Map>`;

export const lootSetXml = (name: string, items: string[] = []): string => {
  const itemTags = items.map((n) => `    <Item>${n}</Item>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<LootSet xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}">
  <Items>
${itemTags}
  </Items>
</LootSet>`;
};

export const spawnGroupXml = (name: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<SpawnGroup xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}"/>`;

export const serverConfigXml = (name: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<ServerConfig xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}"/>`;
