import * as CFB from 'cfb';
import JSZip from 'jszip';

export interface SlideTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontSizePt?: number;
}

export interface SlideParagraph {
  align: 'left' | 'center' | 'right' | 'justify';
  runs: SlideTextRun[];
}

export interface SlideElement {
  id: string;
  kind: 'text' | 'image';
  x: number; // % of slide width
  y: number; // % of slide height
  w: number; // % of slide width
  h: number; // % of slide height
  rotationDeg?: number;
  paragraphs?: SlideParagraph[];
  fillColor?: string;
  strokeColor?: string;
  valign?: 'top' | 'middle' | 'bottom';
  imageSrc?: string;
}

export interface ParsedSlide {
  slideNumber: number;
  title: string;
  backgroundColor?: string;
  backgroundGradient?: string;
  backgroundImage?: string;
  elements: SlideElement[];
  plainTextLines: string[];
  notesText: string;
}

export interface ParsedPresentation {
  format: 'pptx' | 'ppt';
  slideWidthPx: number;
  slideHeightPx: number;
  slides: ParsedSlide[];
  mediaUrlsToRevoke: string[];
  warnings: string[];
}

// ---------------- LIGHTWEIGHT XML TREE PARSER (Browser + Node safe) ----------------

interface XmlNode {
  tag: string;
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw)) !== null) {
    const fullName = match[1];
    const value = decodeXmlEntities(match[2] ?? match[3] ?? '');
    attrs[fullName] = value;
    const colon = fullName.indexOf(':');
    if (colon >= 0) {
      attrs[fullName.slice(colon + 1)] = value;
    }
  }
  return attrs;
}

function parseXml(xmlInput: string): XmlNode | null {
  const xml = xmlInput.replace(/^\uFEFF/, '');
  const root: XmlNode = {
    tag: '__root__',
    local: '__root__',
    attrs: {},
    children: [],
    text: '',
  };
  const stack: XmlNode[] = [root];

  // Match XML comments, CDATA, PIs/declarations, tags, or text chunks
  const tokenRe =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(xml)) !== null) {
    const cdata = match[1];
    if (cdata !== undefined) {
      stack[stack.length - 1].text += cdata;
      continue;
    }

    const closingSlash = match[2];
    const tagName = match[3];
    const rawAttrs = match[4];
    const selfClose = match[5];
    const textChunk = match[6];

    if (textChunk !== undefined) {
      const parent = stack[stack.length - 1];
      if (parent.local === 't' || /[^\s]/.test(textChunk)) {
        parent.text += decodeXmlEntities(textChunk);
      }
      continue;
    }

    if (!tagName) continue;

    if (closingSlash === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tagName) {
          stack.length = i;
          break;
        }
      }
    } else {
      const colon = tagName.indexOf(':');
      const node: XmlNode = {
        tag: tagName,
        local: colon >= 0 ? tagName.slice(colon + 1) : tagName,
        attrs: rawAttrs ? parseAttributes(rawAttrs) : {},
        children: [],
        text: '',
      };
      stack[stack.length - 1].children.push(node);
      if (selfClose !== '/') {
        stack.push(node);
      }
    }
  }

  return root.children[0] || null;
}

function findChild(node: XmlNode | null | undefined, localName: string): XmlNode | undefined {
  return node?.children.find((c) => c.local === localName);
}

function findChildren(node: XmlNode | null | undefined, localName: string): XmlNode[] {
  return node ? node.children.filter((c) => c.local === localName) : [];
}

function findAll(node: XmlNode | null | undefined, localName: string): XmlNode[] {
  if (!node) return [];
  const results: XmlNode[] = [];
  const walk = (curr: XmlNode) => {
    for (const ch of curr.children) {
      if (ch.local === localName) results.push(ch);
      walk(ch);
    }
  };
  walk(node);
  return results;
}

function gatherText(node: XmlNode): string {
  let out = node.text;
  for (const ch of node.children) {
    out += gatherText(ch);
  }
  return out;
}

// ---------------- PPTX PATHS & COLOR HELPERS ----------------

function normalizeZipPath(baseDir: string, target: string): string {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir ? `${baseDir}/${target}` : target).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function relsPathFor(partPath: string): string {
  const idx = partPath.lastIndexOf('/');
  const dir = idx >= 0 ? partPath.slice(0, idx) : '';
  const name = idx >= 0 ? partPath.slice(idx + 1) : partPath;
  return dir ? `${dir}/_rels/${name}.rels` : `_rels/${name}.rels`;
}

interface RelEntry {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

async function readRels(zip: JSZip, partPath: string): Promise<Map<string, RelEntry>> {
  const map = new Map<string, RelEntry>();
  const file = zip.file(relsPathFor(partPath));
  if (!file) return map;
  const doc = parseXml(await file.async('string'));
  const baseDir = dirOf(partPath);
  for (const rel of findChildren(doc, 'Relationship')) {
    const id = rel.attrs.Id || '';
    const target = rel.attrs.Target || '';
    const external = rel.attrs.TargetMode === 'External';
    if (!id || !target) continue;
    map.set(id, {
      id,
      type: rel.attrs.Type || '',
      target: external ? target : normalizeZipPath(baseDir, target),
      external,
    });
  }
  return map;
}

const DEFAULT_THEME_COLORS: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '1F2937',
  lt2: 'F3F4F6',
  accent1: '3B82F6',
  accent2: 'EF4444',
  accent3: '10B981',
  accent4: '8B5CF6',
  accent5: 'F59E0B',
  accent6: '06B6D4',
  hlink: '2563EB',
  folHlink: '7C3AED',
};

function applyColorTransforms(hexNoHash: string, colorNode: XmlNode): string {
  let r = parseInt(hexNoHash.slice(0, 2), 16) / 255;
  let g = parseInt(hexNoHash.slice(2, 4), 16) / 255;
  let b = parseInt(hexNoHash.slice(4, 6), 16) / 255;

  for (const mod of colorNode.children) {
    const val = Number(mod.attrs.val || '0') / 100000;
    if (!Number.isFinite(val)) continue;
    if (mod.local === 'tint') {
      r = r + (1 - r) * (1 - val);
      g = g + (1 - g) * (1 - val);
      b = b + (1 - b) * (1 - val);
    } else if (mod.local === 'shade') {
      r = r * val;
      g = g * val;
      b = b * val;
    } else if (mod.local === 'lumMod' || mod.local === 'lumOff') {
      // Lightweight luminance adjustment
      const factor = mod.local === 'lumMod' ? val : 1;
      const offset = mod.local === 'lumOff' ? val : 0;
      r = Math.min(1, Math.max(0, r * factor + offset));
      g = Math.min(1, Math.max(0, g * factor + offset));
      b = Math.min(1, Math.max(0, b * factor + offset));
    }
  }

  const toHex = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function resolveColorNode(
  fillContainer: XmlNode | undefined,
  themeColors: Record<string, string>,
  clrMap: Record<string, string>
): string | undefined {
  if (!fillContainer) return undefined;
  const solid =
    fillContainer.local === 'solidFill'
      ? fillContainer
      : findChild(fillContainer, 'solidFill');
  const source = solid || fillContainer;

  const srgb = findChild(source, 'srgbClr');
  if (srgb?.attrs.val && /^[0-9a-fA-F]{6}$/.test(srgb.attrs.val)) {
    return applyColorTransforms(srgb.attrs.val, srgb);
  }

  const scheme = findChild(source, 'schemeClr');
  if (scheme?.attrs.val) {
    const mapped = clrMap[scheme.attrs.val] || scheme.attrs.val;
    const baseHex = themeColors[mapped] || DEFAULT_THEME_COLORS[mapped];
    if (baseHex) {
      return applyColorTransforms(baseHex, scheme);
    }
  }

  const prst = findChild(source, 'prstClr');
  if (prst?.attrs.val) {
    const presetMap: Record<string, string> = {
      black: '000000',
      white: 'FFFFFF',
      red: 'DC2626',
      green: '16A34A',
      blue: '2563EB',
      yellow: 'EAB308',
      gray: '6B7280',
    };
    const hex = presetMap[prst.attrs.val];
    if (hex) return applyColorTransforms(hex, prst);
  }

  return undefined;
}

function mimeFromMediaPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const sliceSize = 8192;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + sliceSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

// ---------------- PPTX SHAPE / PLACEHOLDER HELPERS ----------------

interface BoxEmu {
  x: number;
  y: number;
  cx: number;
  cy: number;
  rotDeg?: number;
}

function readXfrm(xfrmNode: XmlNode | undefined): BoxEmu | null {
  if (!xfrmNode) return null;
  const off = findChild(xfrmNode, 'off');
  const ext = findChild(xfrmNode, 'ext');
  if (!off || !ext) return null;
  const x = Number(off.attrs.x || '0');
  const y = Number(off.attrs.y || '0');
  const cx = Number(ext.attrs.cx || '0');
  const cy = Number(ext.attrs.cy || '0');
  if (!Number.isFinite(x) || !Number.isFinite(y) || cx <= 0 || cy <= 0) return null;
  const rotRaw = Number(xfrmNode.attrs.rot || '0');
  const rotDeg = Number.isFinite(rotRaw) && rotRaw !== 0 ? rotRaw / 60000 : undefined;
  return { x, y, cx, cy, rotDeg };
}

interface PlaceholderTemplate {
  box?: BoxEmu;
  defaultSizePt?: number;
  defaultColor?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
}

function collectPlaceholders(doc: XmlNode | null, themeColors: Record<string, string>, clrMap: Record<string, string>) {
  const byIdx = new Map<string, PlaceholderTemplate>();
  const byType = new Map<string, PlaceholderTemplate>();
  if (!doc) return { byIdx, byType };

  for (const sp of findAll(doc, 'sp')) {
    const nvPr = findChild(findChild(sp, 'nvSpPr'), 'nvPr');
    const ph = findChild(nvPr, 'ph');
    if (!ph) continue;
    const phType = ph.attrs.type || '';
    const phIdx = ph.attrs.idx || '';
    const xfrm = readXfrm(findChild(findChild(sp, 'spPr'), 'xfrm'));

    const txBody = findChild(sp, 'txBody');
    const lvl1 = findChild(findChild(txBody, 'lstStyle'), 'lvl1pPr');
    const defRPr = findChild(lvl1, 'defRPr');
    const szRaw = Number(defRPr?.attrs.sz || '0');
    const defaultSizePt = szRaw > 0 ? szRaw / 100 : undefined;
    const defaultColor = resolveColorNode(defRPr, themeColors, clrMap);
    const algn = lvl1?.attrs.algn;
    const align: PlaceholderTemplate['align'] =
      algn === 'ctr'
        ? 'center'
        : algn === 'r'
          ? 'right'
          : algn === 'just'
            ? 'justify'
            : algn === 'l'
              ? 'left'
              : undefined;

    const tpl: PlaceholderTemplate = {
      box: xfrm || undefined,
      defaultSizePt,
      defaultColor,
      align,
    };
    if (phIdx) byIdx.set(phIdx, tpl);
    if (phType) byType.set(phType, tpl);
  }
  return { byIdx, byType };
}

function defaultFontSizeForPlaceholder(phType: string): number {
  if (phType === 'ctrTitle' || phType === 'title') return 38;
  if (phType === 'subTitle') return 24;
  return 20;
}

// ---------------- MAIN PPTX PARSER ----------------

export async function parsePptxBuffer(buffer: ArrayBuffer): Promise<ParsedPresentation> {
  const zip = await JSZip.loadAsync(buffer);
  const presXmlText = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXmlText) {
    throw new Error('Invalid .pptx file (missing ppt/presentation.xml).');
  }

  const presDoc = parseXml(presXmlText);
  const presRels = await readRels(zip, 'ppt/presentation.xml');
  const sldSz = findChild(presDoc, 'sldSz');
  const slideWidthEmu = Math.max(1, Number(sldSz?.attrs.cx || '12192000'));
  const slideHeightEmu = Math.max(1, Number(sldSz?.attrs.cy || '6858000'));

  const slideWidthPx = Math.max(480, Math.round(slideWidthEmu / 9525));
  const slideHeightPx = Math.max(360, Math.round(slideHeightEmu / 9525));

  // Theme colors
  const themeColors: Record<string, string> = { ...DEFAULT_THEME_COLORS };
  const themePaths = Object.keys(zip.files).filter((p) =>
    /^ppt\/theme\/theme\d+\.xml$/i.test(p)
  );
  if (themePaths.length > 0) {
    const themeDoc = parseXml(await zip.file(themePaths.sort()[0])!.async('string'));
    const clrScheme = findAll(themeDoc, 'clrScheme')[0];
    if (clrScheme) {
      for (const entry of clrScheme.children) {
        const srgb = findChild(entry, 'srgbClr');
        const sys = findChild(entry, 'sysClr');
        const val = srgb?.attrs.val || sys?.attrs.lastClr;
        if (val && /^[0-9a-fA-F]{6}$/.test(val)) {
          themeColors[entry.local] = val;
        }
      }
    }
  }

  // Ordered slide file paths
  let slidePaths: string[] = [];
  const sldIdLst = findChild(presDoc, 'sldIdLst');
  if (sldIdLst) {
    for (const sldId of findChildren(sldIdLst, 'sldId')) {
      const rId = sldId.attrs['r:id'] || sldId.attrs.id;
      const rel = rId ? presRels.get(rId) : undefined;
      if (rel && !rel.external && zip.file(rel.target)) {
        slidePaths.push(rel.target);
      }
    }
  }
  if (slidePaths.length === 0) {
    slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)/i)?.[1] || 0);
        const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0);
        return na - nb;
      });
  }

  const mediaUrlsToRevoke: string[] = [];
  const mediaCache = new Map<string, string>();

  const loadMediaUrl = async (zipPath: string): Promise<string | undefined> => {
    if (!zipPath) return undefined;
    if (mediaCache.has(zipPath)) return mediaCache.get(zipPath);
    const entry = zip.file(zipPath);
    if (!entry) return undefined;
    const bytes = await entry.async('uint8array');
    const mime = mimeFromMediaPath(zipPath);
    let url: string;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
      mediaUrlsToRevoke.push(url);
    } else {
      url = bytesToDataUri(bytes, mime);
    }
    mediaCache.set(zipPath, url);
    return url;
  };

  // Cache parsed layouts/masters
  const docCache = new Map<string, XmlNode | null>();
  const relsCache = new Map<string, Map<string, RelEntry>>();

  const getXmlDoc = async (path: string): Promise<XmlNode | null> => {
    if (docCache.has(path)) return docCache.get(path) ?? null;
    const f = zip.file(path);
    const parsed = f ? parseXml(await f.async('string')) : null;
    docCache.set(path, parsed);
    return parsed;
  };

  const getPartRels = async (path: string): Promise<Map<string, RelEntry>> => {
    if (relsCache.has(path)) return relsCache.get(path)!;
    const rels = await readRels(zip, path);
    relsCache.set(path, rels);
    return rels;
  };

  const slides: ParsedSlide[] = [];

  for (let idx = 0; idx < slidePaths.length; idx++) {
    const slidePath = slidePaths[idx];
    const slideDoc = await getXmlDoc(slidePath);
    if (!slideDoc) continue;
    const slideRels = await getPartRels(slidePath);

    // Find layout & master for theme color mapping + background + placeholder inheritance
    const layoutRel = Array.from(slideRels.values()).find((r) =>
      r.type.includes('/slideLayout')
    );
    const layoutPath = layoutRel?.target || '';
    const layoutDoc = layoutPath ? await getXmlDoc(layoutPath) : null;
    const layoutRels = layoutPath ? await getPartRels(layoutPath) : new Map<string, RelEntry>();

    const masterRel = Array.from(layoutRels.values()).find((r) =>
      r.type.includes('/slideMaster')
    );
    const masterPath = masterRel?.target || '';
    const masterDoc = masterPath ? await getXmlDoc(masterPath) : null;
    const masterRels = masterPath ? await getPartRels(masterPath) : new Map<string, RelEntry>();

    // Color map (e.g., bg1->lt1, tx1->dk1)
    const clrMap: Record<string, string> = {
      bg1: 'lt1',
      tx1: 'dk1',
      bg2: 'lt2',
      tx2: 'dk2',
      accent1: 'accent1',
      accent2: 'accent2',
      accent3: 'accent3',
      accent4: 'accent4',
      accent5: 'accent5',
      accent6: 'accent6',
      hlink: 'hlink',
      folHlink: 'folHlink',
    };
    const masterClrMap = findChild(masterDoc, 'clrMap');
    if (masterClrMap) {
      for (const [k, v] of Object.entries(masterClrMap.attrs)) {
        clrMap[k] = v;
      }
    }

    // Background resolution: slide -> layout -> master
    let backgroundColor: string | undefined;
    let backgroundGradient: string | undefined;
    let backgroundImage: string | undefined;

    const bgSources: Array<{ doc: XmlNode | null; rels: Map<string, RelEntry> }> = [
      { doc: slideDoc, rels: slideRels },
      { doc: layoutDoc, rels: layoutRels },
      { doc: masterDoc, rels: masterRels },
    ];

    for (const src of bgSources) {
      const cSld = findChild(src.doc, 'cSld');
      const bg = findChild(cSld, 'bg');
      if (!bg) continue;
      const bgPr = findChild(bg, 'bgPr');
      const bgRef = findChild(bg, 'bgRef');

      if (bgPr) {
        const solid = resolveColorNode(bgPr, themeColors, clrMap);
        if (solid) {
          backgroundColor = solid;
          break;
        }
        const gradFill = findChild(bgPr, 'gradFill');
        if (gradFill) {
          const stops = findChildren(findChild(gradFill, 'gsLst'), 'gs');
          const colors = stops
            .map((gs) => resolveColorNode(gs, themeColors, clrMap))
            .filter((c): c is string => Boolean(c));
          if (colors.length >= 2) {
            backgroundGradient = `linear-gradient(160deg, ${colors.join(', ')})`;
            break;
          } else if (colors.length === 1) {
            backgroundColor = colors[0];
            break;
          }
        }
        const blip = findChild(findChild(bgPr, 'blipFill'), 'blip');
        const rId = blip?.attrs['r:embed'] || blip?.attrs.embed;
        if (rId) {
          const mediaRel = src.rels.get(rId);
          if (mediaRel && !mediaRel.external) {
            backgroundImage = await loadMediaUrl(mediaRel.target);
            if (backgroundImage) break;
          }
        }
      } else if (bgRef) {
        const refColor = resolveColorNode(bgRef, themeColors, clrMap);
        if (refColor) {
          backgroundColor = refColor;
          break;
        }
      }
    }

    if (!backgroundColor && !backgroundGradient && !backgroundImage) {
      const bg1Mapped = clrMap.bg1 || 'lt1';
      backgroundColor = `#${themeColors[bg1Mapped] || 'FFFFFF'}`;
    }

    const layoutPh = collectPlaceholders(layoutDoc, themeColors, clrMap);
    const masterPh = collectPlaceholders(masterDoc, themeColors, clrMap);
    const defaultTextColor = `#${themeColors[clrMap.tx1 || 'dk1'] || '0F172A'}`;

    const elements: SlideElement[] = [];
    const plainTextLines: string[] = [];
    let elementSeq = 0;

    const transformEmuToBox = (
      localBox: BoxEmu,
      parentFrame?: { src: BoxEmu; ch: BoxEmu }
    ): BoxEmu => {
      if (!parentFrame) return localBox;
      const scaleX = parentFrame.src.cx / Math.max(1, parentFrame.ch.cx);
      const scaleY = parentFrame.src.cy / Math.max(1, parentFrame.ch.cy);
      return {
        x: parentFrame.src.x + (localBox.x - parentFrame.ch.x) * scaleX,
        y: parentFrame.src.y + (localBox.y - parentFrame.ch.y) * scaleY,
        cx: localBox.cx * scaleX,
        cy: localBox.cy * scaleY,
        rotDeg: localBox.rotDeg,
      };
    };

    const parseSpTree = async (
      spTree: XmlNode | undefined,
      parentFrame?: { src: BoxEmu; ch: BoxEmu }
    ) => {
      if (!spTree) return;

      for (const child of spTree.children) {
        if (child.local === 'grpSp') {
          const grpPr = findChild(child, 'grpSpPr');
          const grpXfrm = findChild(grpPr, 'xfrm');
          const src = readXfrm(grpXfrm);
          const chOff = findChild(grpXfrm, 'chOff');
          const chExt = findChild(grpXfrm, 'chExt');
          if (src && chOff && chExt) {
            const chBox: BoxEmu = {
              x: Number(chOff.attrs.x || '0'),
              y: Number(chOff.attrs.y || '0'),
              cx: Math.max(1, Number(chExt.attrs.cx || '1')),
              cy: Math.max(1, Number(chExt.attrs.cy || '1')),
            };
            const mappedSrc = transformEmuToBox(src, parentFrame);
            await parseSpTree(child, { src: mappedSrc, ch: chBox });
          } else {
            await parseSpTree(child, parentFrame);
          }
          continue;
        }

        if (child.local === 'pic') {
          const spPr = findChild(child, 'spPr');
          const rawBox = readXfrm(findChild(spPr, 'xfrm'));
          if (!rawBox) continue;
          const box = transformEmuToBox(rawBox, parentFrame);

          const blip = findChild(findChild(child, 'blipFill'), 'blip');
          const rId = blip?.attrs['r:embed'] || blip?.attrs.embed;
          const mediaRel = rId ? slideRels.get(rId) : undefined;
          if (!mediaRel || mediaRel.external) continue;
          const imageSrc = await loadMediaUrl(mediaRel.target);
          if (!imageSrc) continue;

          elements.push({
            id: `el-${++elementSeq}`,
            kind: 'image',
            x: (box.x / slideWidthEmu) * 100,
            y: (box.y / slideHeightEmu) * 100,
            w: (box.cx / slideWidthEmu) * 100,
            h: (box.cy / slideHeightEmu) * 100,
            rotationDeg: box.rotDeg,
            imageSrc,
          });
          continue;
        }

        if (child.local === 'sp') {
          const nvPr = findChild(findChild(child, 'nvSpPr'), 'nvPr');
          const ph = findChild(nvPr, 'ph');
          const phType = ph?.attrs.type || '';
          const phIdx = ph?.attrs.idx || '';
          const tpl =
            (phIdx && (layoutPh.byIdx.get(phIdx) || masterPh.byIdx.get(phIdx))) ||
            (phType && (layoutPh.byType.get(phType) || masterPh.byType.get(phType))) ||
            undefined;

          const spPr = findChild(child, 'spPr');
          const rawBox = readXfrm(findChild(spPr, 'xfrm')) || tpl?.box;
          const txBody = findChild(child, 'txBody');
          if (!rawBox && !txBody) continue;

          const fillColor = resolveColorNode(spPr, themeColors, clrMap);
          const ln = findChild(spPr, 'ln');
          const strokeColor = resolveColorNode(ln, themeColors, clrMap);

          const bodyPr = findChild(txBody, 'bodyPr');
          const anchor = bodyPr?.attrs.anchor;
          const valign: SlideElement['valign'] =
            anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';

          const paragraphs: SlideParagraph[] = [];
          if (txBody) {
            for (const pNode of findChildren(txBody, 'p')) {
              const pPr = findChild(pNode, 'pPr');
              const algn = pPr?.attrs.algn;
              const align: SlideParagraph['align'] =
                algn === 'ctr'
                  ? 'center'
                  : algn === 'r'
                    ? 'right'
                    : algn === 'just'
                      ? 'justify'
                      : algn === 'l'
                        ? 'left'
                        : tpl?.align || (phType === 'ctrTitle' ? 'center' : 'left');

              const pDefRPr = findChild(pPr, 'defRPr');
              const runs: SlideTextRun[] = [];

              for (const node of pNode.children) {
                if (node.local === 'br') {
                  runs.push({ text: '\n' });
                  continue;
                }
                if (node.local !== 'r' && node.local !== 'fld') continue;
                const rPr = findChild(node, 'rPr') || pDefRPr;
                const tNode = findChild(node, 't');
                const txt = tNode ? gatherText(tNode) : '';
                if (!txt) continue;

                const szRaw = Number(rPr?.attrs.sz || pDefRPr?.attrs.sz || '0');
                const fontSizePt =
                  szRaw > 0
                    ? szRaw / 100
                    : tpl?.defaultSizePt || defaultFontSizeForPlaceholder(phType);

                const color =
                  resolveColorNode(rPr, themeColors, clrMap) ||
                  resolveColorNode(pDefRPr, themeColors, clrMap) ||
                  tpl?.defaultColor ||
                  defaultTextColor;

                runs.push({
                  text: txt,
                  bold: rPr?.attrs.b === '1' || rPr?.attrs.b === 'true',
                  italic: rPr?.attrs.i === '1' || rPr?.attrs.i === 'true',
                  underline: Boolean(rPr?.attrs.u && rPr.attrs.u !== 'none'),
                  color,
                  fontSizePt,
                });
              }

              const paraText = runs.map((r) => r.text).join('').trim();
              if (paraText) {
                plainTextLines.push(paraText);
              }
              paragraphs.push({ align, runs });
            }
          }

          if (!rawBox && plainTextLines.length === 0) continue;
          const fallbackBox: BoxEmu = rawBox || {
            x: Math.round(slideWidthEmu * 0.08),
            y: Math.round(slideHeightEmu * 0.12),
            cx: Math.round(slideWidthEmu * 0.84),
            cy: Math.round(slideHeightEmu * 0.76),
          };
          const box = transformEmuToBox(fallbackBox, parentFrame);

          // Skip completely empty non-filled shapes
          if (
            paragraphs.every((p) => p.runs.length === 0) &&
            !fillColor &&
            !strokeColor
          ) {
            continue;
          }

          elements.push({
            id: `el-${++elementSeq}`,
            kind: 'text',
            x: (box.x / slideWidthEmu) * 100,
            y: (box.y / slideHeightEmu) * 100,
            w: (box.cx / slideWidthEmu) * 100,
            h: (box.cy / slideHeightEmu) * 100,
            rotationDeg: box.rotDeg,
            paragraphs,
            fillColor,
            strokeColor,
            valign,
          });
          continue;
        }

        if (child.local === 'graphicFrame') {
          const xfrm = readXfrm(findChild(child, 'xfrm'));
          const tableRows = findAll(child, 'tr');
          if (!xfrm || tableRows.length === 0) continue;
          const box = transformEmuToBox(xfrm, parentFrame);
          const paragraphs: SlideParagraph[] = [];
          for (const tr of tableRows) {
            const cells = findChildren(tr, 'tc')
              .map((tc) => findAll(tc, 't').map(gatherText).join('').trim())
              .filter(Boolean);
            if (cells.length > 0) {
              const line = cells.join('   |   ');
              plainTextLines.push(line);
              paragraphs.push({
                align: 'left',
                runs: [{ text: line, fontSizePt: 18, color: defaultTextColor }],
              });
            }
          }
          if (paragraphs.length > 0) {
            elements.push({
              id: `el-${++elementSeq}`,
              kind: 'text',
              x: (box.x / slideWidthEmu) * 100,
              y: (box.y / slideHeightEmu) * 100,
              w: (box.cx / slideWidthEmu) * 100,
              h: (box.cy / slideHeightEmu) * 100,
              paragraphs,
              valign: 'top',
            });
          }
        }
      }
    };

    const spTree = findChild(findChild(slideDoc, 'cSld'), 'spTree');
    await parseSpTree(spTree);

    // Notes slide text if attached
    let notesText = '';
    const notesRel = Array.from(slideRels.values()).find((r) =>
      r.type.includes('/notesSlide')
    );
    if (notesRel && !notesRel.external) {
      const notesDoc = await getXmlDoc(notesRel.target);
      if (notesDoc) {
        const noteLines: string[] = [];
        for (const sp of findAll(notesDoc, 'sp')) {
          const phType =
            findChild(findChild(findChild(sp, 'nvSpPr'), 'nvPr'), 'ph')?.attrs
              .type || '';
          if (phType === 'sldNum' || phType === 'sldImg') continue;
          for (const p of findAll(sp, 'p')) {
            const line = findAll(p, 't').map(gatherText).join('').trim();
            if (line) noteLines.push(line);
          }
        }
        notesText = noteLines.join('\n');
      }
    }

    const slideTitle =
      plainTextLines[0]?.slice(0, 80) || `Slide ${idx + 1}`;

    slides.push({
      slideNumber: idx + 1,
      title: slideTitle,
      backgroundColor,
      backgroundGradient,
      backgroundImage,
      elements,
      plainTextLines,
      notesText,
    });
  }

  return {
    format: 'pptx',
    slideWidthPx,
    slideHeightPx,
    slides,
    mediaUrlsToRevoke,
    warnings:
      slides.length === 0
        ? ['No slides were found inside this .pptx presentation.']
        : [],
  };
}

// ---------------- LEGACY BINARY .PPT PARSER (MS-PPT OLE2) ----------------

interface PptRecordHeader {
  recVer: number;
  recInstance: number;
  recType: number;
  recLen: number;
}

function readPptRecordHeader(data: Uint8Array, offset: number): PptRecordHeader | null {
  if (offset + 8 > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const verInst = view.getUint16(offset, true);
  const recType = view.getUint16(offset + 2, true);
  const recLen = view.getUint32(offset + 4, true);
  return {
    recVer: verInst & 0x0f,
    recInstance: verInst >> 4,
    recType,
    recLen,
  };
}

function decodeUtf16Le(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-16le').decode(bytes);
  } catch {
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    }
    return out;
  }
}

function decodeLatin1(bytes: Uint8Array): string {
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes[i]);
    }
    return out;
  }
}

function cleanBinarySlideText(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u000b/g, '\n')
    .replace(/[\u0000-\u0008\u000c\u000e-\u001f]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseLegacyPptBuffer(buffer: ArrayBuffer): ParsedPresentation {
  const bytes = new Uint8Array(buffer);
  const warnings: string[] = [
    'Legacy binary .ppt format: displaying extracted slide text offline. Save as .pptx for full slide layouts and embedded images, or download the original .ppt file.',
  ];

  const container = CFB.read(bytes, { type: 'array' });
  const docEntry =
    CFB.find(container, 'PowerPoint Document') ||
    CFB.find(container, '/PowerPoint Document') ||
    container.FileIndex.find((entry) =>
      entry.name.toLowerCase().includes('powerpoint document')
    );

  if (!docEntry || !docEntry.content) {
    return {
      format: 'ppt',
      slideWidthPx: 1280,
      slideHeightPx: 720,
      slides: [
        {
          slideNumber: 1,
          title: 'Legacy PowerPoint (.ppt)',
          backgroundColor: '#0f172a',
          elements: [],
          plainTextLines: [
            'Unable to locate the PowerPoint Document stream in this .ppt file.',
            'Use the Download button in the top bar to open this file directly in PowerPoint or LibreOffice.',
          ],
          notesText: '',
        },
      ],
      mediaUrlsToRevoke: [],
      warnings,
    };
  }

  const stream =
    docEntry.content instanceof Uint8Array
      ? docEntry.content
      : new Uint8Array(docEntry.content as number[]);

  // MS-PPT Record Types
  const RT_DOCUMENT = 0x03e8;
  const RT_SLIDE = 0x03ee;
  const RT_MAIN_MASTER = 0x03f8;
  const RT_SLIDE_LIST_WITH_TEXT = 0x0ff0;
  const RT_SLIDE_PERSIST_ATOM = 0x03f3;
  const RT_TEXT_CHARS_ATOM = 0x0fa0;
  const RT_TEXT_BYTES_ATOM = 0x0fa8;

  const listSlides: string[][] = [];
  const slideContainerTexts: string[][] = [];

  const collectTextAtoms = (start: number, end: number, target: string[]) => {
    let pos = start;
    while (pos + 8 <= end) {
      const h = readPptRecordHeader(stream, pos);
      if (!h) break;
      const bodyStart = pos + 8;
      const bodyEnd = Math.min(end, bodyStart + h.recLen);
      if (h.recType === RT_TEXT_CHARS_ATOM) {
        target.push(...cleanBinarySlideText(decodeUtf16Le(stream.subarray(bodyStart, bodyEnd))));
      } else if (h.recType === RT_TEXT_BYTES_ATOM) {
        target.push(...cleanBinarySlideText(decodeLatin1(stream.subarray(bodyStart, bodyEnd))));
      } else if (h.recVer === 0x0f && bodyEnd > bodyStart) {
        collectTextAtoms(bodyStart, bodyEnd, target);
      }
      if (bodyEnd <= pos) break;
      pos = bodyEnd;
    }
  };

  let cursor = 0;
  while (cursor + 8 <= stream.length) {
    const h = readPptRecordHeader(stream, cursor);
    if (!h) break;
    const bodyStart = cursor + 8;
    const bodyEnd = Math.min(stream.length, bodyStart + h.recLen);

    if (h.recType === RT_DOCUMENT && h.recVer === 0x0f) {
      let docPos = bodyStart;
      while (docPos + 8 <= bodyEnd) {
        const dh = readPptRecordHeader(stream, docPos);
        if (!dh) break;
        const dStart = docPos + 8;
        const dEnd = Math.min(bodyEnd, dStart + dh.recLen);
        // recInstance === 0 holds actual presentation slide texts (1 = masters, 2 = notes)
        if (dh.recType === RT_SLIDE_LIST_WITH_TEXT && dh.recInstance === 0) {
          let sPos = dStart;
          let currentBucket: string[] | null = null;
          while (sPos + 8 <= dEnd) {
            const sh = readPptRecordHeader(stream, sPos);
            if (!sh) break;
            const sBodyStart = sPos + 8;
            const sBodyEnd = Math.min(dEnd, sBodyStart + sh.recLen);
            if (sh.recType === RT_SLIDE_PERSIST_ATOM) {
              currentBucket = [];
              listSlides.push(currentBucket);
            } else if (currentBucket) {
              if (sh.recType === RT_TEXT_CHARS_ATOM) {
                currentBucket.push(
                  ...cleanBinarySlideText(decodeUtf16Le(stream.subarray(sBodyStart, sBodyEnd)))
                );
              } else if (sh.recType === RT_TEXT_BYTES_ATOM) {
                currentBucket.push(
                  ...cleanBinarySlideText(decodeLatin1(stream.subarray(sBodyStart, sBodyEnd)))
                );
              }
            }
            if (sBodyEnd <= sPos) break;
            sPos = sBodyEnd;
          }
        }
        if (dEnd <= docPos) break;
        docPos = dEnd;
      }
    } else if (h.recType === RT_SLIDE && h.recVer === 0x0f) {
      const bucket: string[] = [];
      collectTextAtoms(bodyStart, bodyEnd, bucket);
      if (bucket.length > 0) slideContainerTexts.push(bucket);
    } else if (h.recType === RT_MAIN_MASTER) {
      // Skip master template placeholders
    }

    if (bodyEnd <= cursor) break;
    cursor = bodyEnd;
  }

  // Merge SlideListWithText + Slide container texts cleanly
  const maxLen = Math.max(listSlides.length, slideContainerTexts.length);
  const rawSlides: string[][] = [];
  for (let i = 0; i < maxLen; i++) {
    const combined: string[] = [];
    const seen = new Set<string>();
    for (const line of [...(listSlides[i] || []), ...(slideContainerTexts[i] || [])]) {
      if (!seen.has(line)) {
        seen.add(line);
        combined.push(line);
      }
    }
    if (combined.length > 0 || i < listSlides.length) {
      rawSlides.push(combined);
    }
  }

  const parsedSlides: ParsedSlide[] = rawSlides
    .filter((lines) => lines.length > 0)
    .map((lines, index) => {
      const [firstLine, ...restLines] = lines;
      const elements: SlideElement[] = [
        {
          id: `ppt-title-${index + 1}`,
          kind: 'text',
          x: 7,
          y: 10,
          w: 86,
          h: restLines.length > 0 ? 18 : 78,
          valign: 'middle',
          paragraphs: [
            {
              align: 'center',
              runs: [
                {
                  text: firstLine,
                  bold: true,
                  color: '#FDE68A',
                  fontSizePt: restLines.length > 0 ? 34 : 38,
                },
              ],
            },
          ],
        },
      ];

      if (restLines.length > 0) {
        elements.push({
          id: `ppt-body-${index + 1}`,
          kind: 'text',
          x: 8,
          y: 30,
          w: 84,
          h: 60,
          valign: 'top',
          paragraphs: restLines.map((line) => ({
            align: 'center',
            runs: [{ text: line, color: '#F8FAFC', fontSizePt: 24 }],
          })),
        });
      }

      return {
        slideNumber: index + 1,
        title: firstLine.slice(0, 80),
        backgroundColor: '#0f172a',
        backgroundGradient: 'linear-gradient(155deg, #0f172a, #1e293b)',
        elements,
        plainTextLines: lines,
        notesText: '',
      };
    });

  if (parsedSlides.length === 0) {
    parsedSlides.push({
      slideNumber: 1,
      title: 'Legacy PowerPoint (.ppt)',
      backgroundColor: '#0f172a',
      elements: [],
      plainTextLines: [
        'No extractable text found in this legacy .ppt file (it may be encrypted or image-only).',
        'Use Download to open it in PowerPoint, or re-save as .pptx for full offline slide rendering.',
      ],
      notesText: '',
    });
  }

  return {
    format: 'ppt',
    slideWidthPx: 1280,
    slideHeightPx: 720,
    slides: parsedSlides,
    mediaUrlsToRevoke: [],
    warnings,
  };
}

export async function parsePresentationBlob(
  blob: Blob,
  hintType: 'ppt' | 'pptx'
): Promise<ParsedPresentation> {
  const buffer = await blob.arrayBuffer();
  const header = new Uint8Array(buffer.slice(0, 4));
  const isZip = header[0] === 0x50 && header[1] === 0x4b;

  if (isZip) {
    return parsePptxBuffer(buffer);
  }
  if (hintType === 'ppt' || (header[0] === 0xd0 && header[1] === 0xcf)) {
    return parseLegacyPptBuffer(buffer);
  }
  return parsePptxBuffer(buffer);
}
