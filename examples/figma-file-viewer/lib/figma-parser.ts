/**
 * Figma File Parser
 * Parses Figma JSON exports and .fig files
 */

import type {
  FigmaFile,
  FigmaNode,
  ComponentTreeNode,
  DocumentNode,
  CanvasNode,
  FrameNode,
  GroupNode,
  TextNode,
  VectorNode,
  Color,
  Paint,
  Effect,
} from "./figma-types";

/**
 * FigmaArchiveParser - Parses the fig-kiwi binary format
 * Implemented inline to avoid CJS/ESM import issues with fig-kiwi package
 */
const FIG_KIWI_PRELUDE = "fig-kiwi";

class FigmaArchiveParser {
  private offset = 0;
  private buffer: Uint8Array;
  private data: DataView;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  private readUint32(): number {
    const n = this.data.getUint32(this.offset, true);
    this.offset += 4;
    return n;
  }

  private read(bytes: number): Uint8Array {
    if (this.offset + bytes <= this.buffer.length) {
      const d = this.buffer.slice(this.offset, this.offset + bytes);
      this.offset += bytes;
      return d;
    } else {
      throw new Error(`read(${bytes}) is past end of data`);
    }
  }

  private readHeader(): { prelude: string; version: number } {
    const preludeData = this.read(FIG_KIWI_PRELUDE.length);
    const prelude = String.fromCharCode.apply(String, Array.from(preludeData));
    if (prelude !== FIG_KIWI_PRELUDE) {
      throw new Error(`Unexpected prelude: "${prelude}"`);
    }
    const version = this.readUint32();
    return { prelude, version };
  }

  readAll(): { header: { prelude: string; version: number }; files: Uint8Array[] } {
    const header = this.readHeader();
    const files: Uint8Array[] = [];
    while (this.offset + 4 < this.buffer.length) {
      const size = this.readUint32();
      const data = this.read(size);
      files.push(data);
    }
    return { header, files };
  }

  static parseArchive(data: Uint8Array): { header: { prelude: string; version: number }; files: Uint8Array[] } {
    const parser = new FigmaArchiveParser(data);
    return parser.readAll();
  }
}

export class FigmaParser {
  private file: FigmaFile | null = null;
  private images: Map<string, string> = new Map();

  /**
   * Parse a Figma JSON file
   */
  async parseJSON(jsonString: string): Promise<FigmaFile> {
    try {
      const parsed = JSON.parse(jsonString);

      // Validate basic structure
      if (!parsed.document) {
        throw new Error("Invalid Figma file: missing document property");
      }

      this.file = parsed as FigmaFile;
      return this.file;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Invalid JSON format");
      }
      throw error;
    }
  }

  /**
   * Parse a .fig file using fig-kiwi library
   * Handles Figma's proprietary binary format
   */
  async parseFigFile(arrayBuffer: ArrayBuffer): Promise<FigmaFile> {
    try {
      // Try to parse as JSON first (some exports are JSON)
      const text = new TextDecoder().decode(arrayBuffer);
      if (text.trim().startsWith("{")) {
        return this.parseJSON(text);
      }

      // Import required libraries
      const JSZip = (await import("jszip")).default;
      const { decodeBinarySchema, compileSchema } = await import("kiwi-schema");
      const { inflateRaw } = await import("pako");

      // Try to load as ZIP (standard .fig format)
      const zip = new JSZip();
      const contents = await zip.loadAsync(arrayBuffer);

      // Look for meta.json to get file name
      const metaFile = contents.file("meta.json");
      let fileName = "Figma Document";
      if (metaFile) {
        const metaContent = await metaFile.async("string");
        const meta = JSON.parse(metaContent);
        fileName = meta.file_name || fileName;
      }

      // Extract thumbnail if available
      const thumbnailFile = contents.file("thumbnail.png");
      if (thumbnailFile) {
        const thumbnailData = await thumbnailFile.async("base64");
        this.images.set("thumbnail", `data:image/png;base64,${thumbnailData}`);
      }

      // Extract images - convert to base64 data URLs for portability
      const imageFiles = contents.file(/^images\//);
      for (const imageFile of imageFiles) {
        if (!imageFile.dir) {
          const imageData = await imageFile.async("base64");
          const imageName = imageFile.name.split("/").pop() || "";
          // Detect image type from first bytes or default to png
          this.images.set(imageName, `data:image/png;base64,${imageData}`);
        }
      }

      // Parse canvas.fig using fig-kiwi
      const canvasFile = contents.file("canvas.fig");
      if (!canvasFile) {
        throw new Error("No canvas.fig found in .fig archive");
      }

      const canvasData = await canvasFile.async("uint8array");

      // Parse the fig-kiwi archive
      const { header, files } = FigmaArchiveParser.parseArchive(canvasData);
      const [schemaCompressed, dataCompressed] = files;

      // Decompress and decode schema
      const schema = decodeBinarySchema(inflateRaw(schemaCompressed));
      const compiledSchema = compileSchema(schema);

      // Decode the message
      const message = compiledSchema.decodeMessage(inflateRaw(dataCompressed));

      // Convert to our FigmaFile format
      const figmaFile = this.convertFigKiwiToFigmaFile(message, fileName);
      this.file = figmaFile;
      return figmaFile;
    } catch (error) {
      console.error("Error parsing .fig file:", error);
      throw new Error(`Failed to parse .fig file: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Convert fig-kiwi message format to our FigmaFile format
   */
  private convertFigKiwiToFigmaFile(message: any, fileName?: string): FigmaFile {
    const nodes = new Map<string, any>();
    const rootNodes: any[] = [];

    // Process nodeChanges to build node map
    if (message.nodeChanges) {
      for (const change of message.nodeChanges) {
        const nodeId = this.formatNodeId(change.guid);
        const node = this.convertFigKiwiNode(change, nodeId);
        nodes.set(nodeId, node);

        // Track root-level nodes (pages/canvases)
        if (change.type === "CANVAS" || (!change.parentIndex && change.type === "DOCUMENT")) {
          rootNodes.push(node);
        }
      }
    }

    // Build parent-child relationships
    if (message.nodeChanges) {
      for (const change of message.nodeChanges) {
        if (change.parentIndex) {
          const parentId = this.formatNodeId(change.parentIndex.guid);
          const childId = this.formatNodeId(change.guid);
          const parent = nodes.get(parentId);
          const child = nodes.get(childId);

          if (parent && child) {
            if (!parent.children) parent.children = [];
            parent.children.push(child);
          }
        }
      }
    }

    // Find or create document node
    let documentNode = Array.from(nodes.values()).find((n) => n.type === "DOCUMENT");
    if (!documentNode) {
      // Create document with pages as children
      const pages = Array.from(nodes.values()).filter((n) => n.type === "CANVAS");
      documentNode = {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: pages,
      };
    }

    return {
      name: fileName || message.pasteFileKey || "Figma Document",
      document: documentNode as DocumentNode,
      schemaVersion: 0,
      version: "1.0.0",
    };
  }

  /**
   * Format a GUID object to Figma's node ID format
   */
  private formatNodeId(guid: any): string {
    if (!guid) return "0:0";
    if (typeof guid === "string") return guid;
    return `${guid.sessionID || 0}:${guid.localID || 0}`;
  }

  /**
   * Convert a fig-kiwi node to our node format
   */
  private convertFigKiwiNode(change: any, nodeId: string): FigmaNode {
    const node: any = {
      id: nodeId,
      name: change.name || `Node ${nodeId}`,
      type: change.type || "FRAME",
      visible: change.visible !== false,
    };

    // Handle bounding box
    if (change.size) {
      node.absoluteBoundingBox = {
        x: change.transform?.m02 || 0,
        y: change.transform?.m12 || 0,
        width: change.size.x || 0,
        height: change.size.y || 0,
      };
    }

    // Handle fills
    if (change.fillPaints && change.fillPaints.length > 0) {
      node.fills = change.fillPaints.map((paint: any) => this.convertPaint(paint));
    }

    // Handle strokes
    if (change.strokePaints && change.strokePaints.length > 0) {
      node.strokes = change.strokePaints.map((paint: any) => this.convertPaint(paint));
      node.strokeWeight = change.strokeWeight || 1;
    }

    // Handle text with full styling
    if (change.type === "TEXT") {
      node.characters = change.textData?.characters || change.name || "";

      // Parse font weight from style name
      const fontStyle = change.fontName?.style || "";
      let fontWeight = 400;
      if (fontStyle.includes("Thin")) fontWeight = 100;
      else if (fontStyle.includes("ExtraLight") || fontStyle.includes("UltraLight")) fontWeight = 200;
      else if (fontStyle.includes("Light")) fontWeight = 300;
      else if (fontStyle.includes("Regular") || fontStyle.includes("Normal")) fontWeight = 400;
      else if (fontStyle.includes("Medium")) fontWeight = 500;
      else if (fontStyle.includes("SemiBold") || fontStyle.includes("DemiBold")) fontWeight = 600;
      else if (fontStyle.includes("ExtraBold") || fontStyle.includes("UltraBold")) fontWeight = 800;
      else if (fontStyle.includes("Bold")) fontWeight = 700;
      else if (fontStyle.includes("Black") || fontStyle.includes("Heavy")) fontWeight = 900;

      // Detect italic
      const fontStyleCSS = fontStyle.includes("Italic") || fontStyle.includes("Oblique") ? "italic" : "normal";

      node.style = {
        fontFamily: change.fontName?.family || "Inter",
        fontWeight: fontWeight,
        fontSize: change.fontSize || 16,
        fontStyle: fontStyleCSS,
        textAlignHorizontal: change.textAlignHorizontal || "LEFT",
        textAlignVertical: change.textAlignVertical || "TOP",
        letterSpacing: change.letterSpacing?.value || 0,
        letterSpacingUnit: change.letterSpacing?.units || "PIXELS",
        lineHeightPx: change.lineHeight?.units === "PIXELS" ? change.lineHeight.value : undefined,
        lineHeightPercent: change.lineHeight?.units === "PERCENT" ? change.lineHeight.value : undefined,
      };
    }

    // Handle corner radius - individual corners take priority
    if (change.rectangleTopLeftCornerRadius !== undefined ||
        change.rectangleTopRightCornerRadius !== undefined ||
        change.rectangleBottomLeftCornerRadius !== undefined ||
        change.rectangleBottomRightCornerRadius !== undefined) {
      node.rectangleCornerRadii = [
        change.rectangleTopLeftCornerRadius || 0,
        change.rectangleTopRightCornerRadius || 0,
        change.rectangleBottomRightCornerRadius || 0,
        change.rectangleBottomLeftCornerRadius || 0,
      ];
    } else if (change.cornerRadius !== undefined) {
      node.cornerRadius = change.cornerRadius;
    }

    // Handle opacity
    if (change.opacity !== undefined) {
      node.opacity = change.opacity;
    }

    // Handle blend mode
    if (change.blendMode && change.blendMode !== "PASS_THROUGH") {
      node.blendMode = change.blendMode;
    }

    // Handle effects
    if (change.effects && change.effects.length > 0) {
      node.effects = change.effects.map((effect: any) => this.convertEffect(effect));
    }

    // Handle layout properties
    if (change.stackMode) {
      node.layoutMode = change.stackMode === 1 ? "HORIZONTAL" : "VERTICAL";
    }
    if (change.stackSpacing !== undefined) {
      node.itemSpacing = change.stackSpacing;
    }
    if (change.stackPadding !== undefined) {
      node.paddingLeft = change.stackPadding;
      node.paddingRight = change.stackPadding;
      node.paddingTop = change.stackPadding;
      node.paddingBottom = change.stackPadding;
    }

    return node as FigmaNode;
  }

  /**
   * Convert a hash object (with numeric keys 0-19) to hex string
   */
  private hashToHex(hash: any): string {
    if (!hash) return "";
    const bytes: number[] = [];
    for (let i = 0; i < 20; i++) {
      if (hash[i] !== undefined) {
        bytes.push(hash[i]);
      }
    }
    return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Convert fig-kiwi paint to our paint format
   */
  private convertPaint(paint: any): Paint {
    const result: Paint = {
      type: "SOLID",
      visible: paint.visible !== false,
    };

    if (paint.type === "IMAGE") {
      result.type = "IMAGE";
      result.opacity = paint.opacity ?? 1;
      result.scaleMode = paint.imageScaleMode || "FILL";
      // Convert hash to hex string for image lookup
      if (paint.image?.hash) {
        const hashHex = this.hashToHex(paint.image.hash);
        result.imageRef = hashHex;
        // Store the blob URL if we have it
        if (this.images.has(hashHex)) {
          (result as any).imageUrl = this.images.get(hashHex);
        }
      }
    } else if (paint.type === "SOLID" || !paint.type) {
      result.type = "SOLID";
      if (paint.color) {
        result.color = {
          r: paint.color.r || 0,
          g: paint.color.g || 0,
          b: paint.color.b || 0,
          a: paint.color.a ?? 1,
        };
      }
      result.opacity = paint.opacity ?? 1;
    } else if (paint.type === "GRADIENT_LINEAR") {
      result.type = "GRADIENT_LINEAR";
      result.gradientStops = paint.gradientStops;
      result.gradientHandlePositions = paint.gradientHandlePositions;
    } else if (paint.type === "GRADIENT_RADIAL") {
      result.type = "GRADIENT_RADIAL";
      result.gradientStops = paint.gradientStops;
    }

    return result;
  }

  /**
   * Convert fig-kiwi effect to our effect format
   */
  private convertEffect(effect: any): Effect {
    return {
      type: effect.type || "DROP_SHADOW",
      visible: effect.visible !== false,
      color: effect.color,
      offset: effect.offset,
      radius: effect.radius || 0,
      spread: effect.spread || 0,
    };
  }

  /**
   * Get the current parsed file
   */
  getFile(): FigmaFile | null {
    return this.file;
  }

  /**
   * Build a component tree from the parsed file
   */
  buildComponentTree(node?: FigmaNode): ComponentTreeNode | null {
    const targetNode = node || this.file?.document;
    if (!targetNode) return null;

    return this.nodeToTreeNode(targetNode);
  }

  /**
   * Convert a Figma node to a tree node
   */
  private nodeToTreeNode(node: FigmaNode): ComponentTreeNode {
    const treeNode: ComponentTreeNode = {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible !== false,
      hasContent: this.nodeHasContent(node),
    };

    // Handle children for container nodes
    if ("children" in node && Array.isArray(node.children)) {
      treeNode.children = node.children.map((child) =>
        this.nodeToTreeNode(child as FigmaNode)
      );
    }

    return treeNode;
  }

  /**
   * Check if a node has renderable content
   */
  private nodeHasContent(node: FigmaNode): boolean {
    switch (node.type) {
      case "TEXT":
        return !!(node as TextNode).characters;
      case "VECTOR":
      case "LINE":
      case "ELLIPSE":
      case "RECTANGLE":
      case "REGULAR_POLYGON":
      case "STAR":
        return true;
      case "FRAME":
      case "GROUP":
      case "COMPONENT":
      case "INSTANCE":
        return "children" in node && Array.isArray(node.children) && node.children.length > 0;
      default:
        return false;
    }
  }

  /**
   * Find a node by ID
   */
  findNodeById(id: string, rootNode?: FigmaNode): FigmaNode | null {
    const root = rootNode || this.file?.document;
    if (!root) return null;

    if (root.id === id) return root;

    if ("children" in root && Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = this.findNodeById(id, child as FigmaNode);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Get all pages (canvases) from the document
   */
  getPages(): CanvasNode[] {
    if (!this.file?.document?.children) return [];
    return this.file.document.children.filter(
      (child): child is CanvasNode => child.type === "CANVAS"
    );
  }

  /**
   * Get all components from the file
   */
  getComponents(): Map<string, FigmaNode> {
    const components = new Map<string, FigmaNode>();

    const findComponents = (node: FigmaNode) => {
      if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
        components.set(node.id, node);
      }
      if ("children" in node && Array.isArray(node.children)) {
        node.children.forEach((child) => findComponents(child as FigmaNode));
      }
    };

    if (this.file?.document) {
      findComponents(this.file.document);
    }

    return components;
  }

  /**
   * Extract all text content from the document
   */
  extractTextContent(): { id: string; name: string; text: string }[] {
    const textNodes: { id: string; name: string; text: string }[] = [];

    const findText = (node: FigmaNode) => {
      if (node.type === "TEXT") {
        const textNode = node as TextNode;
        textNodes.push({
          id: textNode.id,
          name: textNode.name,
          text: textNode.characters || "",
        });
      }
      if ("children" in node && Array.isArray(node.children)) {
        node.children.forEach((child) => findText(child as FigmaNode));
      }
    };

    if (this.file?.document) {
      findText(this.file.document);
    }

    return textNodes;
  }

  /**
   * Get document statistics
   */
  getStatistics(): {
    totalNodes: number;
    nodesByType: Record<string, number>;
    pageCount: number;
    componentCount: number;
    textNodes: number;
  } {
    const stats = {
      totalNodes: 0,
      nodesByType: {} as Record<string, number>,
      pageCount: 0,
      componentCount: 0,
      textNodes: 0,
    };

    const countNodes = (node: FigmaNode) => {
      stats.totalNodes++;
      stats.nodesByType[node.type] = (stats.nodesByType[node.type] || 0) + 1;

      if (node.type === "CANVAS") stats.pageCount++;
      if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
        stats.componentCount++;
      }
      if (node.type === "TEXT") stats.textNodes++;

      if ("children" in node && Array.isArray(node.children)) {
        node.children.forEach((child) => countNodes(child as FigmaNode));
      }
    };

    if (this.file?.document) {
      countNodes(this.file.document);
    }

    return stats;
  }
}

/**
 * Utility functions for working with Figma colors
 */
export function colorToRgba(color: Color): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a ?? 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function colorToHex(color: Color): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, "0");
  const g = Math.round(color.g * 255).toString(16).padStart(2, "0");
  const b = Math.round(color.b * 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

/**
 * Convert Figma paint to CSS
 */
export function paintToCSS(paint: Paint): string | null {
  if (paint.visible === false) return null;

  switch (paint.type) {
    case "SOLID":
      if (paint.color) {
        const color = colorToRgba({
          ...paint.color,
          a: (paint.color.a ?? 1) * (paint.opacity ?? 1),
        });
        return color;
      }
      return null;

    case "GRADIENT_LINEAR":
      if (paint.gradientHandlePositions && paint.gradientStops) {
        const [start, end] = paint.gradientHandlePositions;
        const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI) + 90;
        const stops = paint.gradientStops
          .map((stop) => `${colorToRgba(stop.color)} ${stop.position * 100}%`)
          .join(", ");
        return `linear-gradient(${angle}deg, ${stops})`;
      }
      return null;

    case "GRADIENT_RADIAL":
      if (paint.gradientStops) {
        const stops = paint.gradientStops
          .map((stop) => `${colorToRgba(stop.color)} ${stop.position * 100}%`)
          .join(", ");
        return `radial-gradient(circle, ${stops})`;
      }
      return null;

    case "IMAGE":
      // Check for imageUrl (blob URL from parsed .fig file)
      if ((paint as any).imageUrl) {
        const scaleMode = paint.scaleMode || "FILL";
        const size = scaleMode === "FILL" ? "cover" : scaleMode === "FIT" ? "contain" : "auto";
        return `url(${(paint as any).imageUrl}) center/${size} no-repeat`;
      }
      return null;

    default:
      return null;
  }
}

/**
 * Convert Figma effects to CSS
 */
export function effectsToCSS(effects: Effect[]): {
  boxShadow?: string;
  filter?: string;
  backdropFilter?: string;
} {
  const result: {
    boxShadow?: string;
    filter?: string;
    backdropFilter?: string;
  } = {};

  const shadows: string[] = [];
  const filters: string[] = [];
  const backdropFilters: string[] = [];

  for (const effect of effects) {
    if (effect.visible === false) continue;

    switch (effect.type) {
      case "DROP_SHADOW":
        if (effect.color && effect.offset) {
          const color = colorToRgba(effect.color);
          shadows.push(
            `${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread || 0}px ${color}`
          );
        }
        break;

      case "INNER_SHADOW":
        if (effect.color && effect.offset) {
          const color = colorToRgba(effect.color);
          shadows.push(
            `inset ${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread || 0}px ${color}`
          );
        }
        break;

      case "LAYER_BLUR":
        filters.push(`blur(${effect.radius}px)`);
        break;

      case "BACKGROUND_BLUR":
        backdropFilters.push(`blur(${effect.radius}px)`);
        break;
    }
  }

  if (shadows.length > 0) result.boxShadow = shadows.join(", ");
  if (filters.length > 0) result.filter = filters.join(" ");
  if (backdropFilters.length > 0) result.backdropFilter = backdropFilters.join(" ");

  return result;
}

/**
 * Create a singleton parser instance
 */
let parserInstance: FigmaParser | null = null;

export function getParser(): FigmaParser {
  if (!parserInstance) {
    parserInstance = new FigmaParser();
  }
  return parserInstance;
}

export function createParser(): FigmaParser {
  return new FigmaParser();
}
