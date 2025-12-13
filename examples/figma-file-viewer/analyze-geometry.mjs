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

  // Find a sample node with fillGeometry
  const nodeWithGeom = message.nodeChanges.find(n => n.fillGeometry?.length > 0);
  if (nodeWithGeom) {
    console.log("=== SAMPLE NODE WITH FILL GEOMETRY ===");
    console.log("Name:", nodeWithGeom.name);
    console.log("Type:", nodeWithGeom.type);
    console.log("fillGeometry:", JSON.stringify(nodeWithGeom.fillGeometry, null, 2));
  }

  // Check vectorData format
  const vectorNode = message.nodeChanges.find(n => n.vectorData?.vectorNetworkBlob);
  if (vectorNode) {
    console.log("\n=== VECTOR NETWORK BLOB ===");
    console.log("Name:", vectorNode.name);
    const blob = vectorNode.vectorData.vectorNetworkBlob;
    console.log("Blob type:", typeof blob);
    console.log("Blob length:", blob?.length || Object.keys(blob).length);
    console.log("First 20 values:", JSON.stringify(blob).substring(0, 200));
  }

  // Check ROUNDED_RECTANGLE geometry specifically
  const roundedRect = message.nodeChanges.find(n => n.type === "ROUNDED_RECTANGLE" && n.fillGeometry?.length > 0);
  if (roundedRect) {
    console.log("\n=== ROUNDED_RECTANGLE GEOMETRY ===");
    console.log("Name:", roundedRect.name);
    console.log("Size:", roundedRect.size);
    console.log("cornerRadius:", roundedRect.cornerRadius);
    console.log("fillGeometry:", JSON.stringify(roundedRect.fillGeometry, null, 2));
  }
}

analyze().catch(console.error);
