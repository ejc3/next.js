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

  // Collect all unique property names across all nodes
  const allProps = new Set();
  const propCounts = {};

  for (const node of message.nodeChanges || []) {
    for (const key of Object.keys(node)) {
      allProps.add(key);
      propCounts[key] = (propCounts[key] || 0) + 1;
    }
  }

  console.log("=== ALL PROPERTIES IN FIG-KIWI DATA ===");
  const sortedProps = [...allProps].sort((a, b) => propCounts[b] - propCounts[a]);
  for (const prop of sortedProps) {
    console.log(`  ${prop}: ${propCounts[prop]} nodes`);
  }

  // Find a sample node with vector geometry
  const vectorNode = message.nodeChanges.find(n => n.vectorData);
  if (vectorNode) {
    console.log("\n=== SAMPLE VECTOR NODE ===");
    console.log("Name:", vectorNode.name);
    console.log("Type:", vectorNode.type);
    console.log("Has vectorData:", !!vectorNode.vectorData);
    if (vectorNode.vectorData) {
      console.log("vectorData keys:", Object.keys(vectorNode.vectorData));
    }
  }

  // Find a sample text node
  const textNode = message.nodeChanges.find(n => n.type === "TEXT");
  if (textNode) {
    console.log("\n=== SAMPLE TEXT NODE ===");
    console.log("Name:", textNode.name);
    console.log("textData:", JSON.stringify(textNode.textData, null, 2)?.substring(0, 500));
    console.log("fontName:", textNode.fontName);
    console.log("fontSize:", textNode.fontSize);
    console.log("textAlignHorizontal:", textNode.textAlignHorizontal);
    console.log("textAlignVertical:", textNode.textAlignVertical);
    console.log("letterSpacing:", textNode.letterSpacing);
    console.log("lineHeight:", textNode.lineHeight);
  }

  // Check for effects
  const nodeWithEffects = message.nodeChanges.find(n => n.effects?.length > 0);
  if (nodeWithEffects) {
    console.log("\n=== SAMPLE NODE WITH EFFECTS ===");
    console.log("Name:", nodeWithEffects.name);
    console.log("Effects:", JSON.stringify(nodeWithEffects.effects, null, 2));
  }

  // Check for blend modes
  const nodeWithBlend = message.nodeChanges.find(n => n.blendMode && n.blendMode !== "PASS_THROUGH");
  if (nodeWithBlend) {
    console.log("\n=== SAMPLE NODE WITH BLEND MODE ===");
    console.log("Name:", nodeWithBlend.name);
    console.log("blendMode:", nodeWithBlend.blendMode);
  }

  // Check for corner radius details
  const nodeWithCorners = message.nodeChanges.find(n => n.cornerRadius > 0 || n.rectangleCornerRadii);
  if (nodeWithCorners) {
    console.log("\n=== SAMPLE NODE WITH CORNER RADIUS ===");
    console.log("Name:", nodeWithCorners.name);
    console.log("cornerRadius:", nodeWithCorners.cornerRadius);
    console.log("rectangleCornerRadii:", nodeWithCorners.rectangleCornerRadii);
  }
}

analyze().catch(console.error);
