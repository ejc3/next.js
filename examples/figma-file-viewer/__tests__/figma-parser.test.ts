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
