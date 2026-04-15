import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

export async function writeXml(
  libraryPath: string,
  type: string,
  filename: string,
  content: string,
): Promise<void> {
  const dir = join(libraryPath, type);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, filename), content, 'utf-8');
}

export async function writeArchivedXml(
  libraryPath: string,
  type: string,
  filename: string,
  content: string,
): Promise<void> {
  const dir = join(libraryPath, type, '.ignore');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, filename), content, 'utf-8');
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

export const castableXml = (name: string, opts: { class?: string; icon?: number } = {}): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Castable xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02"
          Book="PrimarySpell" Elements="Fire"
          Class="${opts.class ?? 'Wizard'}"
          ${opts.icon ? `Icon="${opts.icon}"` : ''}
          IsAssail="false" Reflectable="false" BreakStealth="false"
          IncludeInMetafile="true" PvpOnly="false">
  <Name>${name}</Name>
</Castable>`;

export const statusXml = (name: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Status xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02" Name="${name}" Icon="1" Duration="5" Tick="1"/>`;

export const itemXml = (name: string, opts: { shopTab?: string; category?: string } = {}): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<Item xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02">
  <Name>${name}</Name>
  <Properties>
    ${opts.shopTab ? `<Vendor ShopTab="${opts.shopTab}"/>` : ''}
    ${opts.category ? `<Categories><Category>${opts.category}</Category></Categories>` : ''}
  </Properties>
</Item>`;

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
