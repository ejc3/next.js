import * as fs from 'fs';
import JSZip from 'jszip';
import { decodeBinarySchema, compileSchema } from 'kiwi-schema';
import pako from 'pako';

const FIG_KIWI_PRELUDE = "fig-kiwi";

class FigmaArchiveParser {
  constructor(buffer) {
    this.offset = 0;
    this.buffer = buffer;
    this.data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  readUint32() {
    const n = this.data.getUint32(this.offset, true);
    this.offset += 4;
    return n;
  }
  read(bytes) {
    const d = this.buffer.slice(this.offset, this.offset + bytes);
    this.offset += bytes;
    return d;
  }
  readHeader() {
    const preludeData = this.read(FIG_KIWI_PRELUDE.length);
    const prelude = String.fromCharCode.apply(String, Array.from(preludeData));
    const version = this.readUint32();
    return { prelude, version };
  }
  readAll() {
    const header = this.readHeader();
    const files = [];
    while (this.offset + 4 < this.buffer.length) {
      const size = this.readUint32();
      const data = this.read(size);
      files.push(data);
    }
    return { header, files };
  }
  static parseArchive(data) {
    return new FigmaArchiveParser(data).readAll();
  }
}

async function analyze() {
  const figData = fs.readFileSync('./e2e/fixtures/prototype-group-26.fig');
  const zip = new JSZip();
  const contents = await zip.loadAsync(figData);

  const canvasFile = contents.file("canvas.fig");
  const canvasData = await canvasFile.async("uint8array");
  const { files } = FigmaArchiveParser.parseArchive(canvasData);
  const [schemaCompressed, dataCompressed] = files;
  const schema = decodeBinarySchema(pako.inflateRaw(schemaCompressed));
  const compiledSchema = compileSchema(schema);
  const message = compiledSchema.decodeMessage(pako.inflateRaw(dataCompressed));

  console.log("=== TEXT NODE ANALYSIS ===\n");

  // Find all TEXT nodes
  const textNodes = (message.nodeChanges || []).filter(n => n.type === 'TEXT');
  console.log(`Found ${textNodes.length} TEXT nodes\n`);

  // Analyze text-related properties
  const textProps = new Set();
  const propValues = {};

  for (const node of textNodes) {
    for (const prop of Object.keys(node)) {
      textProps.add(prop);
      if (!propValues[prop]) propValues[prop] = new Set();
      const val = node[prop];
      if (typeof val !== 'object' || val === null) {
        propValues[prop].add(String(val).substring(0, 50));
      } else if (Array.isArray(val)) {
        propValues[prop].add(`[Array ${val.length}]`);
      } else {
        propValues[prop].add(`{${Object.keys(val).join(', ')}}`);
      }
    }
  }

  console.log("=== ALL TEXT NODE PROPERTIES ===");
  for (const prop of [...textProps].sort()) {
    const values = [...propValues[prop]].slice(0, 5);
    console.log(`  ${prop}: ${values.join(' | ')}`);
  }

  // Detailed look at a sample TEXT node
  console.log("\n=== SAMPLE TEXT NODE ===");
  const sample = textNodes[0];
  if (sample) {
    console.log(`Name: ${sample.name}`);
    for (const [key, value] of Object.entries(sample)) {
      if (key === 'guid' || key === 'parentIndex') continue;
      if (typeof value === 'object' && value !== null) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }
  }

  // Look specifically at textData structure
  console.log("\n=== TEXT DATA STRUCTURE ===");
  for (const node of textNodes.slice(0, 3)) {
    if (node.textData) {
      console.log(`\n${node.name}:`);
      console.log(`  textData keys: ${Object.keys(node.textData).join(', ')}`);
      if (node.textData.characters) {
        console.log(`  characters: "${node.textData.characters.substring(0, 50)}..."`);
      }
      if (node.textData.styleOverrideTable) {
        console.log(`  styleOverrideTable: ${JSON.stringify(node.textData.styleOverrideTable).substring(0, 200)}`);
      }
      if (node.textData.layoutSize) {
        console.log(`  layoutSize: ${JSON.stringify(node.textData.layoutSize)}`);
      }
      if (node.textData.baselines) {
        console.log(`  baselines: [${node.textData.baselines.length} items]`);
        if (node.textData.baselines[0]) {
          console.log(`    first: ${JSON.stringify(node.textData.baselines[0])}`);
        }
      }
      if (node.textData.glyphs) {
        console.log(`  glyphs: [${node.textData.glyphs.length} items]`);
        if (node.textData.glyphs[0]) {
          console.log(`    first: ${JSON.stringify(node.textData.glyphs[0])}`);
        }
      }
    }
  }

  // Check for text decoration properties
  console.log("\n=== TEXT STYLE PROPERTIES ===");
  const styleProps = ['textDecoration', 'textCase', 'textAlignHorizontal', 'textAlignVertical',
                      'textAutoResize', 'lineHeight', 'letterSpacing', 'paragraphSpacing',
                      'paragraphIndent', 'textTruncation', 'maxLines'];
  for (const prop of styleProps) {
    const values = new Set();
    for (const node of textNodes) {
      if (node[prop] !== undefined) {
        values.add(String(node[prop]).substring(0, 30));
      }
    }
    if (values.size > 0) {
      console.log(`  ${prop}: ${[...values].join(', ')}`);
    }
  }
}

analyze().catch(console.error);
