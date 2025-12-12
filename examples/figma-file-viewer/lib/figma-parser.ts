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
   * Parse a .fig file (compressed format)
   * Note: .fig files are proprietary and may require special handling
   */
  async parseFigFile(arrayBuffer: ArrayBuffer): Promise<FigmaFile> {
    try {
      // Try to parse as JSON first (some exports are JSON)
      const text = new TextDecoder().decode(arrayBuffer);

      // Check if it's JSON
      if (text.trim().startsWith("{")) {
        return this.parseJSON(text);
      }

      // .fig files are typically compressed archives
      // We'll try to extract and parse them
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      try {
        const contents = await zip.loadAsync(arrayBuffer);

        // Look for the main JSON file in the archive
        const jsonFile = contents.file("canvas.json") ||
                        contents.file("document.json") ||
                        contents.file(/\.json$/i)[0];

        if (jsonFile) {
          const jsonContent = await jsonFile.async("string");
          return this.parseJSON(jsonContent);
        }

        // Try to find any readable content
        const files = Object.keys(contents.files);
        for (const filename of files) {
          if (!contents.files[filename].dir) {
            const content = await contents.files[filename].async("string");
            if (content.includes('"document"') || content.includes('"DOCUMENT"')) {
              return this.parseJSON(content);
            }
          }
        }
      } catch (zipError) {
        // Not a valid zip, try other formats
        console.warn("Not a valid zip archive, trying alternative parsing");
      }

      // If nothing worked, try to extract JSON from binary
      const jsonMatch = text.match(/\{[\s\S]*"document"[\s\S]*\}/);
      if (jsonMatch) {
        return this.parseJSON(jsonMatch[0]);
      }

      throw new Error(
        "Unable to parse .fig file. Please export your Figma file as JSON using the Figma API or a plugin."
      );
    } catch (error) {
      throw new Error(`Failed to parse .fig file: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
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
