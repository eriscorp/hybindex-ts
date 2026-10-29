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

/** `name: null` writes no root `Name`, as `world`'s `config.xml` does. */
export const serverConfigXml = (
  name: string | null,
  opts: { elementTable?: string; body?: string } = {},
): string => {
  const attrs = [
    ...(name != null ? [`Name="${name}"`] : []),
    ...(opts.elementTable != null ? [`ElementTable="${opts.elementTable}"`] : []),
  ].join(' ');
  const open = `<ServerConfig xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" ${attrs}`;
  return `<?xml version="1.0" encoding="utf-8"?>
${opts.body ? `${open}>\n${opts.body}\n</ServerConfig>` : `${open}/>`}`;
};

/** An element table in the old format: `<Source>` rows only. */
export const oldElementTableXml = (name: string | null, sources: string[]): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<ElementTable xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02"${name != null ? ` Name="${name}"` : ''}>
${sources.map((s) => `  <Source Element="${s}"><Target Element="${s}" Multiplier="1"/></Source>`).join('\n')}
</ElementTable>`;

/** An element table in the HXML-24 format, with `<Elements>` and optional `<Groups>`. */
export const elementTableXml = (
  name: string,
  elements: { key: string; id: number; default?: boolean; name?: string }[],
  groups: Record<string, string> = {},
): string => {
  const elementTags = elements
    .map((e) =>
      `    <Element Key="${e.key}" Id="${e.id}"${e.name ? ` Name="${e.name}"` : ''}${e.default ? ' Default="true"' : ''}/>`,
    )
    .join('\n');
  const groupEntries = Object.entries(groups);
  const groupBlock = groupEntries.length
    ? `\n  <Groups>\n${groupEntries.map(([k, m]) => `    <Group Key="${k}" Members="${m}"/>`).join('\n')}\n  </Groups>`
    : '';
  const first = elements[0]?.key ?? 'None';
  return `<?xml version="1.0" encoding="utf-8"?>
<ElementTable xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}">
  <Elements>
${elementTags}
  </Elements>${groupBlock}
  <Source Element="${first}" DefaultMultiplier="1"/>
</ElementTable>`;
};

export const traitXml = (
  name: string,
  opts: { category?: string; exclusiveGroup?: string; policy?: string; conflicts?: string[] } = {},
): string => {
  const group = opts.exclusiveGroup
    ? `\n  <ExclusiveGroup${opts.policy ? ` Policy="${opts.policy}"` : ''}>${opts.exclusiveGroup}</ExclusiveGroup>`
    : '';
  const conflicts = opts.conflicts?.length
    ? `\n  <ConflictsWith>${opts.conflicts.map((c) => `<Trait>${c}</Trait>`).join('')}</ConflictsWith>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<Trait xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}" Icon="1" IconSet="Skill"${opts.category ? ` Category="${opts.category}"` : ''}>
  <Description>A trait.</Description>${group}${conflicts}
</Trait>`;
};

export const speciesXml = (
  key: string,
  opts: {
    id?: number;
    playerOption?: string;
    branchOf?: string;
    bodies?: { key: string; id: number; default?: boolean }[];
  } = {},
): string => {
  const bodies = opts.bodies?.length
    ? `\n  <Bodies>\n${opts.bodies
        .map((b) => `    <Body Key="${b.key}" Id="${b.id}"${b.default ? ' Default="true"' : ''}/>`)
        .join('\n')}\n  </Bodies>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<Species xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Key="${key}" Id="${opts.id ?? 1}" Origin="Aosda" PlayerOption="${opts.playerOption ?? 'Starter'}"${opts.branchOf ? ` BranchOf="${opts.branchOf}"` : ''}>
  <Names Singular="${key}" Plural="${key}s" Adjective="${key}ish"/>${bodies}
</Species>`;
};
