/**
 * Unit tests for Figma Parser
 */

import {
  FigmaParser,
  createParser,
  colorToRgba,
  colorToHex,
  paintToCSS,
  effectsToCSS,
} from "../lib/figma-parser";

describe("FigmaParser", () => {
  let parser: FigmaParser;

  beforeEach(() => {
    parser = createParser();
  });

  describe("parseJSON", () => {
    it("should parse valid Figma JSON", async () => {
      const json = JSON.stringify({
        name: "Test Document",
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [],
        },
      });

      const result = await parser.parseJSON(json);

      expect(result.name).toBe("Test Document");
      expect(result.document.type).toBe("DOCUMENT");
    });

    it("should throw error for invalid JSON", async () => {
      await expect(parser.parseJSON("invalid json {{{")).rejects.toThrow(
        "Invalid JSON format"
      );
    });

    it("should throw error for JSON without document property", async () => {
      await expect(parser.parseJSON('{"name": "test"}')).rejects.toThrow(
        "Invalid Figma file: missing document property"
      );
    });

    it("should parse complex nested structure", async () => {
      const json = JSON.stringify({
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            {
              id: "1:0",
              name: "Page 1",
              type: "CANVAS",
              backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
              children: [
                {
                  id: "2:0",
                  name: "Frame",
                  type: "FRAME",
                  children: [
                    {
                      id: "3:0",
                      name: "Text",
                      type: "TEXT",
                      characters: "Hello World",
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      const result = await parser.parseJSON(json);

      expect(result.document.children).toHaveLength(1);
      expect(result.document.children[0].type).toBe("CANVAS");
    });
  });

  describe("getFile", () => {
    it("should return null before parsing", () => {
      expect(parser.getFile()).toBeNull();
    });

    it("should return parsed file after parsing", async () => {
      await parser.parseJSON(
        JSON.stringify({
          name: "Test",
          document: { id: "0:0", name: "Doc", type: "DOCUMENT", children: [] },
        })
      );

      expect(parser.getFile()).not.toBeNull();
      expect(parser.getFile()?.name).toBe("Test");
    });
  });

  describe("getPages", () => {
    it("should return empty array before parsing", () => {
      expect(parser.getPages()).toEqual([]);
    });

    it("should return canvas nodes as pages", async () => {
      await parser.parseJSON(
        JSON.stringify({
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              {
                id: "1:0",
                name: "Page 1",
                type: "CANVAS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                children: [],
              },
              {
                id: "2:0",
                name: "Page 2",
                type: "CANVAS",
                backgroundColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
                children: [],
              },
            ],
          },
        })
      );

      const pages = parser.getPages();

      expect(pages).toHaveLength(2);
      expect(pages[0].name).toBe("Page 1");
      expect(pages[1].name).toBe("Page 2");
    });
  });

  describe("buildComponentTree", () => {
    it("should return null before parsing", () => {
      expect(parser.buildComponentTree()).toBeNull();
    });

    it("should build tree from parsed document", async () => {
      await parser.parseJSON(
        JSON.stringify({
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              {
                id: "1:0",
                name: "Page",
                type: "CANVAS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                children: [
                  {
                    id: "2:0",
                    name: "Frame",
                    type: "FRAME",
                    children: [],
                  },
                ],
              },
            ],
          },
        })
      );

      const tree = parser.buildComponentTree();

      expect(tree).not.toBeNull();
      expect(tree?.id).toBe("0:0");
      expect(tree?.type).toBe("DOCUMENT");
      expect(tree?.children).toHaveLength(1);
      expect(tree?.children?.[0].type).toBe("CANVAS");
    });

    it("should mark visibility correctly", async () => {
      await parser.parseJSON(
        JSON.stringify({
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              {
                id: "1:0",
                name: "Visible",
                type: "FRAME",
                visible: true,
                children: [],
              },
              {
                id: "2:0",
                name: "Hidden",
                type: "FRAME",
                visible: false,
                children: [],
              },
            ],
          },
        })
      );

      const tree = parser.buildComponentTree();

      expect(tree?.children?.[0].visible).toBe(true);
      expect(tree?.children?.[1].visible).toBe(false);
    });
  });

  describe("findNodeById", () => {
    beforeEach(async () => {
      await parser.parseJSON(
        JSON.stringify({
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              {
                id: "1:0",
                name: "Page",
                type: "CANVAS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                children: [
                  {
                    id: "2:0",
                    name: "Frame",
                    type: "FRAME",
                    children: [
                      {
                        id: "3:0",
                        name: "Text",
                        type: "TEXT",
                        characters: "Hello",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        })
      );
    });

    it("should find root node", () => {
      const node = parser.findNodeById("0:0");
      expect(node?.name).toBe("Document");
    });

    it("should find nested node", () => {
      const node = parser.findNodeById("3:0");
      expect(node?.name).toBe("Text");
      expect(node?.type).toBe("TEXT");
    });

    it("should return null for non-existent id", () => {
      const node = parser.findNodeById("999:999");
      expect(node).toBeNull();
    });
  });

  describe("getComponents", () => {
    it("should find all components in document", async () => {
      await parser.parseJSON(
        JSON.stringify({
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              {
                id: "1:0",
                name: "Page",
                type: "CANVAS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                children: [
                  {
                    id: "2:0",
                    name: "Button",
                    type: "COMPONENT",
                    children: [],
                  },
                  {
                    id: "3:0",
                    name: "Card",
                    type: "COMPONENT",
                    children: [],
                  },
                  {
                    id: "4:0",
                    name: "Frame",
                    type: "FRAME",
                    children: [
                      {
                        id: "5:0",
                        name: "Nested Component",
                        type: "COMPONENT",
                        children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        })
      );

      const components = parser.getComponents();

      expect(components.size).toBe(3);
      expect(components.get("2:0")?.name).toBe("Button");
      expect(components.get("3:0")?.name).toBe("Card");
      expect(components.get("5:0")?.name).toBe("Nested Component");
    });
  });

  describe("extractTextContent", () => {
    it("should extract all text nodes", async () => {
      await parser.parseJSON(
        JSON.stringify({
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              {
                id: "1:0",
                name: "Page",
                type: "CANVAS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                children: [
                  {
                    id: "2:0",
                    name: "Title",
                    type: "TEXT",
                    characters: "Hello World",
                  },
                  {
                    id: "3:0",
                    name: "Frame",
                    type: "FRAME",
                    children: [
                      {
                        id: "4:0",
                        name: "Subtitle",
                        type: "TEXT",
                        characters: "Nested text",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        })
      );

      const textContent = parser.extractTextContent();

      expect(textContent).toHaveLength(2);
      expect(textContent[0]).toEqual({
        id: "2:0",
        name: "Title",
        text: "Hello World",
      });
      expect(textContent[1]).toEqual({
        id: "4:0",
        name: "Subtitle",
        text: "Nested text",
      });
    });
  });

  describe("getStatistics", () => {
    it("should calculate correct statistics", async () => {
      await parser.parseJSON(
        JSON.stringify({
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              {
                id: "1:0",
                name: "Page 1",
                type: "CANVAS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                children: [
                  { id: "2:0", name: "Frame", type: "FRAME", children: [] },
                  { id: "3:0", name: "Text", type: "TEXT", characters: "Hi" },
                  { id: "4:0", name: "Comp", type: "COMPONENT", children: [] },
                ],
              },
              {
                id: "5:0",
                name: "Page 2",
                type: "CANVAS",
                backgroundColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
                children: [
                  { id: "6:0", name: "Text2", type: "TEXT", characters: "Bye" },
                ],
              },
            ],
          },
        })
      );

      const stats = parser.getStatistics();

      expect(stats.totalNodes).toBe(7);
      expect(stats.pageCount).toBe(2);
      expect(stats.componentCount).toBe(1);
      expect(stats.textNodes).toBe(2);
      expect(stats.nodesByType.DOCUMENT).toBe(1);
      expect(stats.nodesByType.CANVAS).toBe(2);
      expect(stats.nodesByType.FRAME).toBe(1);
      expect(stats.nodesByType.TEXT).toBe(2);
      expect(stats.nodesByType.COMPONENT).toBe(1);
    });
  });
});

describe("Color Utilities", () => {
  describe("colorToRgba", () => {
    it("should convert color to rgba string", () => {
      expect(colorToRgba({ r: 1, g: 0, b: 0, a: 1 })).toBe("rgba(255, 0, 0, 1)");
      expect(colorToRgba({ r: 0, g: 1, b: 0, a: 0.5 })).toBe(
        "rgba(0, 255, 0, 0.5)"
      );
      expect(colorToRgba({ r: 0.5, g: 0.5, b: 0.5, a: 1 })).toBe(
        "rgba(128, 128, 128, 1)"
      );
    });

    it("should handle missing alpha", () => {
      expect(colorToRgba({ r: 1, g: 1, b: 1 } as any)).toBe(
        "rgba(255, 255, 255, 1)"
      );
    });
  });

  describe("colorToHex", () => {
    it("should convert color to hex string", () => {
      expect(colorToHex({ r: 1, g: 0, b: 0, a: 1 })).toBe("#ff0000");
      expect(colorToHex({ r: 0, g: 1, b: 0, a: 1 })).toBe("#00ff00");
      expect(colorToHex({ r: 0, g: 0, b: 1, a: 1 })).toBe("#0000ff");
      expect(colorToHex({ r: 1, g: 1, b: 1, a: 1 })).toBe("#ffffff");
      expect(colorToHex({ r: 0, g: 0, b: 0, a: 1 })).toBe("#000000");
    });
  });
});

describe("paintToCSS", () => {
  it("should return null for invisible paint", () => {
    expect(
      paintToCSS({
        type: "SOLID",
        visible: false,
        color: { r: 1, g: 0, b: 0, a: 1 },
      })
    ).toBeNull();
  });

  it("should convert solid paint to rgba", () => {
    expect(
      paintToCSS({
        type: "SOLID",
        color: { r: 1, g: 0, b: 0, a: 1 },
      })
    ).toBe("rgba(255, 0, 0, 1)");
  });

  it("should apply opacity to solid paint", () => {
    expect(
      paintToCSS({
        type: "SOLID",
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 0.5,
      })
    ).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("should convert linear gradient", () => {
    const result = paintToCSS({
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
    });

    expect(result).toContain("linear-gradient");
    expect(result).toContain("rgba(255, 0, 0, 1)");
    expect(result).toContain("rgba(0, 0, 255, 1)");
  });

  it("should convert radial gradient", () => {
    const result = paintToCSS({
      type: "GRADIENT_RADIAL",
      gradientStops: [
        { position: 0, color: { r: 1, g: 1, b: 0, a: 1 } },
        { position: 1, color: { r: 1, g: 0.5, b: 0, a: 1 } },
      ],
    });

    expect(result).toContain("radial-gradient");
  });
});

describe("effectsToCSS", () => {
  it("should convert drop shadow", () => {
    const result = effectsToCSS([
      {
        type: "DROP_SHADOW",
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 4 },
        radius: 8,
        spread: 0,
      },
    ]);

    expect(result.boxShadow).toContain("0px 4px 8px");
    expect(result.boxShadow).toContain("rgba(0, 0, 0, 0.25)");
  });

  it("should convert inner shadow", () => {
    const result = effectsToCSS([
      {
        type: "INNER_SHADOW",
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 2 },
        radius: 4,
      },
    ]);

    expect(result.boxShadow).toContain("inset");
  });

  it("should convert layer blur", () => {
    const result = effectsToCSS([
      {
        type: "LAYER_BLUR",
        visible: true,
        radius: 10,
      },
    ]);

    expect(result.filter).toBe("blur(10px)");
  });

  it("should convert background blur", () => {
    const result = effectsToCSS([
      {
        type: "BACKGROUND_BLUR",
        visible: true,
        radius: 20,
      },
    ]);

    expect(result.backdropFilter).toBe("blur(20px)");
  });

  it("should combine multiple shadows", () => {
    const result = effectsToCSS([
      {
        type: "DROP_SHADOW",
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 2 },
        radius: 4,
      },
      {
        type: "DROP_SHADOW",
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 8 },
        radius: 16,
      },
    ]);

    expect(result.boxShadow).toContain(",");
  });

  it("should ignore invisible effects", () => {
    const result = effectsToCSS([
      {
        type: "DROP_SHADOW",
        visible: false,
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        offset: { x: 0, y: 4 },
        radius: 8,
      },
    ]);

    expect(result.boxShadow).toBeUndefined();
  });
});

describe("Kitchen Sink Integration Test", () => {
  let parser: FigmaParser;

  beforeEach(() => {
    parser = createParser();
  });

  it("should parse kitchen-sink.json with all feature categories", async () => {
    const fs = require("fs");
    const path = require("path");
    const kitchenSinkPath = path.join(
      __dirname,
      "../test-fixtures/kitchen-sink.json"
    );
    const kitchenSinkJson = fs.readFileSync(kitchenSinkPath, "utf-8");

    const result = await parser.parseJSON(kitchenSinkJson);

    // Verify document structure
    expect(result.name).toBe("Kitchen Sink - All Features Test");
    expect(result.document.type).toBe("DOCUMENT");
    expect(result.document.children).toHaveLength(1);

    // Get the canvas
    const canvas = result.document.children[0];
    expect(canvas.type).toBe("CANVAS");

    // Get the main frame containing all feature categories
    const mainFrame = (canvas as any).children[0];
    expect(mainFrame.name).toBe("Main Frame");
    expect(mainFrame.type).toBe("FRAME");

    // Verify all 10 feature categories exist
    const featureFrames = (mainFrame as any).children;
    expect(featureFrames.length).toBeGreaterThanOrEqual(10);

    // Extract feature names
    const featureNames = featureFrames.map((f: any) => f.name);

    // Verify each feature category (numbered sections)
    expect(featureNames).toContain("1. Basic Shapes");
    expect(featureNames).toContain("2. Strokes");
    expect(featureNames).toContain("3. Gradients");
    expect(featureNames).toContain("4. Effects");
    expect(featureNames).toContain("5. Blend Modes & Opacity");
    expect(featureNames).toContain("6. Text Rendering");
    expect(featureNames).toContain("7. Transforms");
    expect(featureNames).toContain("8. Clipping & Masks");
    expect(featureNames).toContain("9. Auto Layout");
    expect(featureNames).toContain("10. Vector Paths & Booleans");
  });

  it("should verify basic shapes have correct properties", async () => {
    const fs = require("fs");
    const path = require("path");
    const kitchenSinkPath = path.join(
      __dirname,
      "../test-fixtures/kitchen-sink.json"
    );
    const kitchenSinkJson = fs.readFileSync(kitchenSinkPath, "utf-8");

    const result = await parser.parseJSON(kitchenSinkJson);
    const canvas = result.document.children[0];
    const mainFrame = (canvas as any).children[0];
    const basicShapes = (mainFrame as any).children.find(
      (c: any) => c.name === "1. Basic Shapes"
    );

    expect(basicShapes).toBeDefined();

    // Find shapes by type
    const shapes = (basicShapes as any).children;
    const rectangle = shapes.find((s: any) => s.type === "RECTANGLE" && s.name === "Rectangle");
    const ellipse = shapes.find((s: any) => s.type === "ELLIPSE");
    const star = shapes.find((s: any) => s.type === "STAR");
    const polygon = shapes.find((s: any) => s.type === "REGULAR_POLYGON");
    const line = shapes.find((s: any) => s.type === "LINE");
    const squircle = shapes.find((s: any) => s.name === "Squircle (iOS)");

    expect(rectangle).toBeDefined();
    expect(ellipse).toBeDefined();
    expect(star).toBeDefined();
    expect(polygon).toBeDefined();
    expect(line).toBeDefined();
    expect(squircle).toBeDefined();

    // Verify squircle has corner smoothing
    expect(squircle.cornerSmoothing).toBeGreaterThan(0);
  });

  it("should verify gradients have correct gradient types", async () => {
    const fs = require("fs");
    const path = require("path");
    const kitchenSinkPath = path.join(
      __dirname,
      "../test-fixtures/kitchen-sink.json"
    );
    const kitchenSinkJson = fs.readFileSync(kitchenSinkPath, "utf-8");

    const result = await parser.parseJSON(kitchenSinkJson);
    const canvas = result.document.children[0];
    const mainFrame = (canvas as any).children[0];
    const gradients = (mainFrame as any).children.find(
      (c: any) => c.name === "3. Gradients"
    );

    expect(gradients).toBeDefined();

    // Get gradient rectangles
    const gradientShapes = (gradients as any).children;

    // Find each gradient type
    const linearGradient = gradientShapes.find(
      (s: any) => s.fills?.[0]?.type === "GRADIENT_LINEAR"
    );
    const radialGradient = gradientShapes.find(
      (s: any) => s.fills?.[0]?.type === "GRADIENT_RADIAL"
    );
    const angularGradient = gradientShapes.find(
      (s: any) => s.fills?.[0]?.type === "GRADIENT_ANGULAR"
    );
    const diamondGradient = gradientShapes.find(
      (s: any) => s.fills?.[0]?.type === "GRADIENT_DIAMOND"
    );

    expect(linearGradient).toBeDefined();
    expect(radialGradient).toBeDefined();
    expect(angularGradient).toBeDefined();
    expect(diamondGradient).toBeDefined();
  });

  it("should verify effects are properly configured", async () => {
    const fs = require("fs");
    const path = require("path");
    const kitchenSinkPath = path.join(
      __dirname,
      "../test-fixtures/kitchen-sink.json"
    );
    const kitchenSinkJson = fs.readFileSync(kitchenSinkPath, "utf-8");

    const result = await parser.parseJSON(kitchenSinkJson);
    const canvas = result.document.children[0];
    const mainFrame = (canvas as any).children[0];
    const effects = (mainFrame as any).children.find(
      (c: any) => c.name === "4. Effects"
    );

    expect(effects).toBeDefined();

    // Get effect shapes
    const effectShapes = (effects as any).children;

    // Find each effect type
    const dropShadow = effectShapes.find((s: any) =>
      s.effects?.some((e: any) => e.type === "DROP_SHADOW")
    );
    const innerShadow = effectShapes.find((s: any) =>
      s.effects?.some((e: any) => e.type === "INNER_SHADOW")
    );
    const blur = effectShapes.find((s: any) =>
      s.effects?.some((e: any) => e.type === "LAYER_BLUR")
    );

    expect(dropShadow).toBeDefined();
    expect(innerShadow).toBeDefined();
    expect(blur).toBeDefined();
  });

  it("should verify text nodes have style properties", async () => {
    const fs = require("fs");
    const path = require("path");
    const kitchenSinkPath = path.join(
      __dirname,
      "../test-fixtures/kitchen-sink.json"
    );
    const kitchenSinkJson = fs.readFileSync(kitchenSinkPath, "utf-8");

    const result = await parser.parseJSON(kitchenSinkJson);
    const canvas = result.document.children[0];
    const mainFrame = (canvas as any).children[0];
    const textRendering = (mainFrame as any).children.find(
      (c: any) => c.name === "6. Text Rendering"
    );

    expect(textRendering).toBeDefined();

    // Get text nodes
    const textNodes = (textRendering as any).children.filter(
      (c: any) => c.type === "TEXT"
    );

    expect(textNodes.length).toBeGreaterThanOrEqual(5);

    // Verify text nodes have characters and style
    for (const textNode of textNodes) {
      expect(textNode.characters).toBeDefined();
      expect(textNode.style).toBeDefined();
    }
  });

  it("should verify transforms are applied correctly", async () => {
    const fs = require("fs");
    const path = require("path");
    const kitchenSinkPath = path.join(
      __dirname,
      "../test-fixtures/kitchen-sink.json"
    );
    const kitchenSinkJson = fs.readFileSync(kitchenSinkPath, "utf-8");

    const result = await parser.parseJSON(kitchenSinkJson);
    const canvas = result.document.children[0];
    const mainFrame = (canvas as any).children[0];
    const transforms = (mainFrame as any).children.find(
      (c: any) => c.name === "7. Transforms"
    );

    expect(transforms).toBeDefined();

    // Get transform shapes (exclude the label text)
    const transformShapes = (transforms as any).children.filter(
      (c: any) => c.type !== "TEXT"
    );

    // Each shape should have a relativeTransform
    for (const shape of transformShapes) {
      expect(shape.relativeTransform).toBeDefined();
      expect(shape.relativeTransform).toHaveLength(2);
      expect(shape.relativeTransform[0]).toHaveLength(3);
      expect(shape.relativeTransform[1]).toHaveLength(3);
    }
  });

  it("should verify auto layout properties", async () => {
    const fs = require("fs");
    const path = require("path");
    const kitchenSinkPath = path.join(
      __dirname,
      "../test-fixtures/kitchen-sink.json"
    );
    const kitchenSinkJson = fs.readFileSync(kitchenSinkPath, "utf-8");

    const result = await parser.parseJSON(kitchenSinkJson);
    const canvas = result.document.children[0];
    const mainFrame = (canvas as any).children[0];
    const autoLayout = (mainFrame as any).children.find(
      (c: any) => c.name === "9. Auto Layout"
    );

    expect(autoLayout).toBeDefined();

    // Get auto layout frames
    const layoutFrames = (autoLayout as any).children.filter(
      (c: any) => c.layoutMode
    );

    expect(layoutFrames.length).toBeGreaterThanOrEqual(2);

    // Verify layout modes exist
    const horizontal = layoutFrames.find(
      (f: any) => f.layoutMode === "HORIZONTAL"
    );
    const vertical = layoutFrames.find(
      (f: any) => f.layoutMode === "VERTICAL"
    );

    expect(horizontal).toBeDefined();
    expect(vertical).toBeDefined();
  });
});
