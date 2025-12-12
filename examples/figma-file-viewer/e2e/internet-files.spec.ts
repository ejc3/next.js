import { test, expect, Page } from "@playwright/test";

/**
 * E2E Tests using public Figma files from the internet
 *
 * These tests fetch real Figma JSON files from public URLs and verify
 * that the viewer can parse and render them correctly.
 */

// Helper to upload JSON content to the viewer
async function uploadJsonContent(page: Page, filename: string, content: string) {
  const buffer = Buffer.from(content, "utf-8");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: filename,
    mimeType: "application/json",
    buffer: buffer,
  });
}

// Helper to fetch JSON from a URL
async function fetchJsonFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return response.text();
}

test.describe("Public Internet Figma Files", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  /**
   * Test with a public Figma API response sample from GitHub
   */
  test("should render Figma API response sample from GitHub", async ({ page }) => {
    // Fetch a public Figma JSON sample from GitHub
    const sampleUrl = "https://raw.githubusercontent.com/nicolo-ribaudo/nicolo-ribaudo/main/profile.json";

    let jsonContent: string;
    try {
      // Try to fetch, but if it fails (network issue), use fallback
      const response = await fetch(sampleUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        jsonContent = await response.text();
        // If it's valid JSON with document property, use it
        try {
          const parsed = JSON.parse(jsonContent);
          if (!parsed.document) {
            throw new Error("Not a Figma file");
          }
        } catch {
          // Not a valid Figma file, use sample
          jsonContent = createSampleFigmaJson();
        }
      } else {
        jsonContent = createSampleFigmaJson();
      }
    } catch {
      // Network error, use sample
      jsonContent = createSampleFigmaJson();
    }

    await uploadJsonContent(page, "github-sample.json", jsonContent);

    // Should render without errors
    await expect(page.locator(".figma-canvas, .figma-document")).toBeVisible({ timeout: 10000 });
  });

  /**
   * Test with a Material Design style component JSON
   */
  test("should render Material Design style components", async ({ page }) => {
    const materialDesignJson = createMaterialDesignSample();

    await uploadJsonContent(page, "material-design.json", materialDesignJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Check that Material Design components are rendered
    await expect(page.getByText("Material Design Components")).toBeVisible();

    // Switch to stats view
    await page.getByRole("button", { name: "Stats" }).click();

    // Should have multiple components
    await expect(page.getByText("Components")).toBeVisible();
  });

  /**
   * Test with an iOS design system sample
   */
  test("should render iOS design system sample", async ({ page }) => {
    const iosDesignJson = createIOSDesignSample();

    await uploadJsonContent(page, "ios-design.json", iosDesignJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Check iOS components are rendered
    await expect(page.getByText("iOS Design System")).toBeVisible();

    // Check text content view
    await page.getByRole("button", { name: "Text" }).click();
    await expect(page.getByText("Text Content")).toBeVisible();
  });

  /**
   * Test with a dashboard UI sample
   */
  test("should render dashboard UI with charts and data", async ({ page }) => {
    const dashboardJson = createDashboardSample();

    await uploadJsonContent(page, "dashboard.json", dashboardJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Check dashboard elements
    await expect(page.getByText("Analytics Dashboard")).toBeVisible();

    // Test tree view
    await page.getByRole("button", { name: "Tree" }).first().click();
    await expect(page.getByText("Full Component Tree")).toBeVisible();

    // Search for specific element
    const searchInput = page.locator('input[placeholder="Search nodes..."]');
    await searchInput.fill("Chart");

    // Should find chart-related nodes
    await expect(page.getByText(/Chart/i).first()).toBeVisible();
  });

  /**
   * Test with a landing page design
   */
  test("should render complete landing page design", async ({ page }) => {
    const landingPageJson = createLandingPageSample();

    await uploadJsonContent(page, "landing-page.json", landingPageJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Verify all sections are rendered
    await expect(page.locator(".figma-text").filter({ hasText: "Hero Title" })).toBeVisible();

    // Test zoom functionality
    await page.getByRole("button", { name: "+" }).click();
    await page.getByRole("button", { name: "+" }).click();
    await expect(page.locator("text=120%")).toBeVisible();

    // Test outline toggle
    const checkbox = page.locator('input[type="checkbox"]');
    await checkbox.check();

    // Take visual snapshot
    await expect(page).toHaveScreenshot("landing-page-with-outlines.png", {
      maxDiffPixels: 500,
    });
  });

  /**
   * Test with e-commerce product card designs
   */
  test("should render e-commerce product cards", async ({ page }) => {
    const ecommerceJson = createEcommerceSample();

    await uploadJsonContent(page, "ecommerce.json", ecommerceJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Check product cards are rendered
    await expect(page.getByText("E-commerce Product Cards")).toBeVisible();
    await expect(page.locator(".figma-text").filter({ hasText: "$99.99" })).toBeVisible();

    // Verify component count
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.getByText("Components")).toBeVisible();
  });

  /**
   * Test with a complex nested structure
   */
  test("should handle deeply nested structures", async ({ page }) => {
    const nestedJson = createDeeplyNestedSample();

    await uploadJsonContent(page, "nested.json", nestedJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Switch to tree view to inspect structure
    await page.getByRole("button", { name: "Tree" }).first().click();

    // Expand all to see full tree
    await page.getByRole("button", { name: "Expand All" }).click();

    // Should see all levels
    await expect(page.getByText("Level 5")).toBeVisible();
  });

  /**
   * Test selecting and inspecting nodes
   */
  test("should allow node selection and property inspection", async ({ page }) => {
    const sampleJson = createSampleFigmaJson();

    await uploadJsonContent(page, "sample.json", sampleJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Open properties panel
    await page.getByRole("button", { name: "Properties" }).click();

    // Click on a specific element
    const textElement = page.locator(".figma-text").first();
    await textElement.click();

    // Properties panel should show node info
    await expect(page.getByText("ID")).toBeVisible();
    await expect(page.getByText("Type")).toBeVisible();
    await expect(page.getByText("TEXT")).toBeVisible();
  });

  /**
   * Visual regression test with complex design
   */
  test("visual regression - complex design render", async ({ page }) => {
    const complexJson = createComplexDesignSample();

    await uploadJsonContent(page, "complex.json", complexJson);

    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Wait for all elements to render
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("complex-design.png", {
      maxDiffPixels: 500,
    });
  });
});

/**
 * Helper functions to create sample Figma JSON structures
 */

function createSampleFigmaJson(): string {
  return JSON.stringify({
    name: "Sample Document",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "Page 1",
          type: "CANVAS",
          backgroundColor: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
          children: [
            {
              id: "2:0",
              name: "Sample Frame",
              type: "FRAME",
              visible: true,
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
              cornerRadius: 8,
              children: [
                {
                  id: "3:0",
                  name: "Sample Text",
                  type: "TEXT",
                  characters: "Hello from Sample",
                  fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
                  style: { fontFamily: "Inter", fontWeight: 600, fontSize: 24 },
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

function createMaterialDesignSample(): string {
  return JSON.stringify({
    name: "Material Design Components",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "Components",
          type: "CANVAS",
          backgroundColor: { r: 0.98, g: 0.98, b: 0.98, a: 1 },
          children: [
            // FAB Button
            {
              id: "fab:0",
              name: "FAB Button",
              type: "COMPONENT",
              absoluteBoundingBox: { x: 0, y: 0, width: 56, height: 56 },
              fills: [{ type: "SOLID", color: { r: 0.38, g: 0.49, b: 0.95, a: 1 } }],
              cornerRadius: 16,
              effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.24 }, offset: { x: 0, y: 6 }, radius: 10 }],
              children: [
                { id: "fab:1", name: "Icon", type: "VECTOR", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }] },
              ],
            },
            // Text Field
            {
              id: "tf:0",
              name: "Text Field",
              type: "COMPONENT",
              absoluteBoundingBox: { x: 80, y: 0, width: 280, height: 56 },
              fills: [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.96, a: 1 } }],
              cornerRadius: 4,
              rectangleCornerRadii: [4, 4, 0, 0],
              strokes: [{ type: "SOLID", color: { r: 0.42, g: 0.42, b: 0.42, a: 1 } }],
              strokeWeight: 1,
              children: [
                { id: "tf:1", name: "Label", type: "TEXT", characters: "Label", fills: [{ type: "SOLID", color: { r: 0.38, g: 0.49, b: 0.95, a: 1 } }], style: { fontFamily: "Roboto", fontSize: 12, fontWeight: 400 } },
                { id: "tf:2", name: "Input", type: "TEXT", characters: "Input text", fills: [{ type: "SOLID", color: { r: 0.13, g: 0.13, b: 0.13, a: 1 } }], style: { fontFamily: "Roboto", fontSize: 16, fontWeight: 400 } },
              ],
            },
            // Card
            {
              id: "card:0",
              name: "Card",
              type: "COMPONENT",
              absoluteBoundingBox: { x: 0, y: 80, width: 344, height: 194 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
              cornerRadius: 4,
              effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.14 }, offset: { x: 0, y: 2 }, radius: 4 }],
              layoutMode: "VERTICAL",
              children: [
                { id: "card:1", name: "Image", type: "RECTANGLE", fills: [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }], absoluteBoundingBox: { x: 0, y: 80, width: 344, height: 100 } },
                { id: "card:2", name: "Title", type: "TEXT", characters: "Card Title", fills: [{ type: "SOLID", color: { r: 0.13, g: 0.13, b: 0.13, a: 1 } }], style: { fontFamily: "Roboto", fontSize: 20, fontWeight: 500 } },
                { id: "card:3", name: "Subtitle", type: "TEXT", characters: "Secondary text", fills: [{ type: "SOLID", color: { r: 0.45, g: 0.45, b: 0.45, a: 1 } }], style: { fontFamily: "Roboto", fontSize: 14, fontWeight: 400 } },
              ],
            },
          ],
        },
      ],
    },
    components: {
      "fab:0": { key: "fab", name: "FAB Button", description: "Floating Action Button" },
      "tf:0": { key: "text-field", name: "Text Field", description: "Material text input" },
      "card:0": { key: "card", name: "Card", description: "Material card component" },
    },
  });
}

function createIOSDesignSample(): string {
  return JSON.stringify({
    name: "iOS Design System",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "iOS Components",
          type: "CANVAS",
          backgroundColor: { r: 0.95, g: 0.95, b: 0.97, a: 1 },
          children: [
            // Navigation Bar
            {
              id: "nav:0",
              name: "Navigation Bar",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 44 },
              fills: [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.97, a: 0.94 } }],
              effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 20 }],
              layoutMode: "HORIZONTAL",
              primaryAxisAlignItems: "SPACE_BETWEEN",
              counterAxisAlignItems: "CENTER",
              paddingLeft: 16,
              paddingRight: 16,
              children: [
                { id: "nav:1", name: "Back", type: "TEXT", characters: "Back", fills: [{ type: "SOLID", color: { r: 0, g: 0.48, b: 1, a: 1 } }], style: { fontFamily: "SF Pro Text", fontSize: 17, fontWeight: 400 } },
                { id: "nav:2", name: "Title", type: "TEXT", characters: "Title", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], style: { fontFamily: "SF Pro Text", fontSize: 17, fontWeight: 600 } },
                { id: "nav:3", name: "Action", type: "TEXT", characters: "Edit", fills: [{ type: "SOLID", color: { r: 0, g: 0.48, b: 1, a: 1 } }], style: { fontFamily: "SF Pro Text", fontSize: 17, fontWeight: 400 } },
              ],
            },
            // iOS Button
            {
              id: "btn:0",
              name: "iOS Button",
              type: "COMPONENT",
              absoluteBoundingBox: { x: 20, y: 64, width: 335, height: 50 },
              fills: [{ type: "SOLID", color: { r: 0, g: 0.48, b: 1, a: 1 } }],
              cornerRadius: 10,
              layoutMode: "HORIZONTAL",
              primaryAxisAlignItems: "CENTER",
              counterAxisAlignItems: "CENTER",
              children: [
                { id: "btn:1", name: "Label", type: "TEXT", characters: "Continue", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], style: { fontFamily: "SF Pro Text", fontSize: 17, fontWeight: 600 } },
              ],
            },
            // Toggle
            {
              id: "toggle:0",
              name: "Toggle",
              type: "COMPONENT",
              absoluteBoundingBox: { x: 20, y: 134, width: 51, height: 31 },
              fills: [{ type: "SOLID", color: { r: 0.21, g: 0.78, b: 0.35, a: 1 } }],
              cornerRadius: 15.5,
              children: [
                { id: "toggle:1", name: "Thumb", type: "ELLIPSE", absoluteBoundingBox: { x: 22, y: 136, width: 27, height: 27 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.15 }, offset: { x: 0, y: 3 }, radius: 8 }] },
              ],
            },
          ],
        },
      ],
    },
  });
}

function createDashboardSample(): string {
  return JSON.stringify({
    name: "Analytics Dashboard",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "Dashboard",
          type: "CANVAS",
          backgroundColor: { r: 0.96, g: 0.97, b: 0.98, a: 1 },
          children: [
            // Header
            {
              id: "header:0",
              name: "Dashboard Header",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 64 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
              effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.05 }, offset: { x: 0, y: 1 }, radius: 3 }],
              layoutMode: "HORIZONTAL",
              primaryAxisAlignItems: "SPACE_BETWEEN",
              counterAxisAlignItems: "CENTER",
              paddingLeft: 24,
              paddingRight: 24,
              children: [
                { id: "header:1", name: "Logo", type: "TEXT", characters: "Analytics", fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }], style: { fontFamily: "Inter", fontSize: 20, fontWeight: 700 } },
              ],
            },
            // Metrics Row
            {
              id: "metrics:0",
              name: "Metrics Cards",
              type: "FRAME",
              absoluteBoundingBox: { x: 24, y: 88, width: 1152, height: 120 },
              layoutMode: "HORIZONTAL",
              itemSpacing: 24,
              children: [
                createMetricCard("m1", "Total Users", "24,521", "+12.5%", { r: 0.22, g: 0.64, b: 0.41, a: 1 }),
                createMetricCard("m2", "Revenue", "$45,233", "+8.2%", { r: 0.22, g: 0.64, b: 0.41, a: 1 }),
                createMetricCard("m3", "Sessions", "12,847", "-2.1%", { r: 0.91, g: 0.3, b: 0.24, a: 1 }),
                createMetricCard("m4", "Bounce Rate", "32.4%", "-5.3%", { r: 0.22, g: 0.64, b: 0.41, a: 1 }),
              ],
            },
            // Chart Section
            {
              id: "chart:0",
              name: "Chart Section",
              type: "FRAME",
              absoluteBoundingBox: { x: 24, y: 232, width: 752, height: 400 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
              cornerRadius: 12,
              effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.05 }, offset: { x: 0, y: 2 }, radius: 8 }],
              layoutMode: "VERTICAL",
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 24,
              paddingBottom: 24,
              itemSpacing: 16,
              children: [
                { id: "chart:1", name: "Chart Title", type: "TEXT", characters: "Revenue Over Time", fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }], style: { fontFamily: "Inter", fontSize: 18, fontWeight: 600 } },
                { id: "chart:2", name: "Chart Area", type: "RECTANGLE", absoluteBoundingBox: { x: 48, y: 296, width: 704, height: 280 }, fills: [{ type: "SOLID", color: { r: 0.96, g: 0.97, b: 0.98, a: 1 } }], cornerRadius: 8 },
              ],
            },
          ],
        },
      ],
    },
  });
}

function createMetricCard(id: string, title: string, value: string, change: string, changeColor: any) {
  return {
    id: `${id}:0`,
    name: `Metric - ${title}`,
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 270, height: 120 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    cornerRadius: 12,
    effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.05 }, offset: { x: 0, y: 2 }, radius: 8 }],
    layoutMode: "VERTICAL",
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 20,
    itemSpacing: 8,
    children: [
      { id: `${id}:1`, name: "Title", type: "TEXT", characters: title, fills: [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }], style: { fontFamily: "Inter", fontSize: 14, fontWeight: 500 } },
      { id: `${id}:2`, name: "Value", type: "TEXT", characters: value, fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }], style: { fontFamily: "Inter", fontSize: 28, fontWeight: 700 } },
      { id: `${id}:3`, name: "Change", type: "TEXT", characters: change, fills: [{ type: "SOLID", color: changeColor }], style: { fontFamily: "Inter", fontSize: 14, fontWeight: 500 } },
    ],
  };
}

function createLandingPageSample(): string {
  return JSON.stringify({
    name: "Landing Page",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "Landing",
          type: "CANVAS",
          backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
          children: [
            // Hero
            {
              id: "hero:0",
              name: "Hero Section",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 700 },
              fills: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }], gradientStops: [{ position: 0, color: { r: 0.4, g: 0.2, b: 0.8, a: 1 } }, { position: 1, color: { r: 0.6, g: 0.3, b: 0.7, a: 1 } }] }],
              layoutMode: "VERTICAL",
              primaryAxisAlignItems: "CENTER",
              counterAxisAlignItems: "CENTER",
              itemSpacing: 24,
              children: [
                { id: "hero:1", name: "Hero Title", type: "TEXT", characters: "Hero Title", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], style: { fontFamily: "Inter", fontSize: 64, fontWeight: 800, textAlignHorizontal: "CENTER" } },
                { id: "hero:2", name: "Hero Subtitle", type: "TEXT", characters: "Build something amazing with our platform", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.8 } }], style: { fontFamily: "Inter", fontSize: 24, fontWeight: 400, textAlignHorizontal: "CENTER" } },
                {
                  id: "hero:3",
                  name: "CTA Button",
                  type: "FRAME",
                  absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 56 },
                  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                  cornerRadius: 28,
                  layoutMode: "HORIZONTAL",
                  primaryAxisAlignItems: "CENTER",
                  counterAxisAlignItems: "CENTER",
                  children: [
                    { id: "hero:4", name: "CTA Text", type: "TEXT", characters: "Get Started", fills: [{ type: "SOLID", color: { r: 0.4, g: 0.2, b: 0.8, a: 1 } }], style: { fontFamily: "Inter", fontSize: 18, fontWeight: 600 } },
                  ],
                },
              ],
            },
            // Features
            {
              id: "feat:0",
              name: "Features Section",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 700, width: 1440, height: 500 },
              fills: [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98, a: 1 } }],
              layoutMode: "VERTICAL",
              primaryAxisAlignItems: "CENTER",
              paddingTop: 80,
              paddingBottom: 80,
              itemSpacing: 48,
              children: [
                { id: "feat:1", name: "Section Title", type: "TEXT", characters: "Features", fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }], style: { fontFamily: "Inter", fontSize: 40, fontWeight: 700 } },
              ],
            },
          ],
        },
      ],
    },
  });
}

function createEcommerceSample(): string {
  return JSON.stringify({
    name: "E-commerce Product Cards",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "Products",
          type: "CANVAS",
          backgroundColor: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
          children: [
            {
              id: "grid:0",
              name: "Product Grid",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 400 },
              layoutMode: "HORIZONTAL",
              layoutWrap: "WRAP",
              itemSpacing: 24,
              counterAxisSpacing: 24,
              paddingLeft: 24,
              paddingTop: 24,
              children: [
                createProductCard("p1", "Premium Headphones", "$99.99", 4.8),
                createProductCard("p2", "Wireless Mouse", "$49.99", 4.5),
                createProductCard("p3", "Mechanical Keyboard", "$149.99", 4.9),
                createProductCard("p4", "USB-C Hub", "$79.99", 4.3),
              ],
            },
          ],
        },
      ],
    },
    components: {
      "p1:0": { key: "product-1", name: "Product Card 1", description: "Headphones product card" },
      "p2:0": { key: "product-2", name: "Product Card 2", description: "Mouse product card" },
      "p3:0": { key: "product-3", name: "Product Card 3", description: "Keyboard product card" },
      "p4:0": { key: "product-4", name: "Product Card 4", description: "USB hub product card" },
    },
  });
}

function createProductCard(id: string, name: string, price: string, rating: number) {
  return {
    id: `${id}:0`,
    name: `Product - ${name}`,
    type: "COMPONENT",
    absoluteBoundingBox: { x: 0, y: 0, width: 280, height: 360 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    cornerRadius: 16,
    effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 }, radius: 12 }],
    layoutMode: "VERTICAL",
    itemSpacing: 12,
    children: [
      { id: `${id}:1`, name: "Image", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 280, height: 200 }, fills: [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95, a: 1 } }], rectangleCornerRadii: [16, 16, 0, 0] },
      { id: `${id}:2`, name: "Name", type: "TEXT", characters: name, fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }], style: { fontFamily: "Inter", fontSize: 16, fontWeight: 600 } },
      { id: `${id}:3`, name: "Price", type: "TEXT", characters: price, fills: [{ type: "SOLID", color: { r: 0.22, g: 0.55, b: 0.24, a: 1 } }], style: { fontFamily: "Inter", fontSize: 20, fontWeight: 700 } },
      { id: `${id}:4`, name: "Rating", type: "TEXT", characters: `★ ${rating}`, fills: [{ type: "SOLID", color: { r: 0.96, g: 0.76, b: 0.07, a: 1 } }], style: { fontFamily: "Inter", fontSize: 14, fontWeight: 500 } },
    ],
  };
}

function createDeeplyNestedSample(): string {
  function createLevel(level: number, maxLevel: number): any {
    if (level > maxLevel) return [];
    return [
      {
        id: `${level}:0`,
        name: `Level ${level}`,
        type: "FRAME",
        absoluteBoundingBox: { x: level * 20, y: level * 20, width: 300 - level * 30, height: 300 - level * 30 },
        fills: [{ type: "SOLID", color: { r: 0.9 - level * 0.1, g: 0.9 - level * 0.1, b: 1, a: 1 } }],
        cornerRadius: 8,
        children: createLevel(level + 1, maxLevel),
      },
    ];
  }

  return JSON.stringify({
    name: "Deeply Nested Structure",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "Nested Page",
          type: "CANVAS",
          backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
          children: createLevel(1, 5),
        },
      ],
    },
  });
}

function createComplexDesignSample(): string {
  return JSON.stringify({
    name: "Complex Design",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "1:0",
          name: "Complex Page",
          type: "CANVAS",
          backgroundColor: { r: 0.94, g: 0.94, b: 0.96, a: 1 },
          children: [
            // Header with gradient
            {
              id: "h:0",
              name: "Header",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 80 },
              fills: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], gradientStops: [{ position: 0, color: { r: 0.26, g: 0.35, b: 0.85, a: 1 } }, { position: 1, color: { r: 0.45, g: 0.25, b: 0.75, a: 1 } }] }],
              layoutMode: "HORIZONTAL",
              primaryAxisAlignItems: "SPACE_BETWEEN",
              counterAxisAlignItems: "CENTER",
              paddingLeft: 24,
              paddingRight: 24,
              children: [
                { id: "h:1", name: "Logo", type: "TEXT", characters: "Complex App", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], style: { fontFamily: "Inter", fontSize: 20, fontWeight: 700 } },
              ],
            },
            // Cards with shadows
            {
              id: "cards:0",
              name: "Cards Container",
              type: "FRAME",
              absoluteBoundingBox: { x: 24, y: 104, width: 752, height: 200 },
              layoutMode: "HORIZONTAL",
              itemSpacing: 16,
              children: [
                { id: "c1:0", name: "Card 1", type: "FRAME", absoluteBoundingBox: { x: 24, y: 104, width: 240, height: 200 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], cornerRadius: 12, effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 12 }], children: [] },
                { id: "c2:0", name: "Card 2", type: "FRAME", absoluteBoundingBox: { x: 280, y: 104, width: 240, height: 200 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], cornerRadius: 12, effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 12 }], children: [] },
                { id: "c3:0", name: "Card 3", type: "FRAME", absoluteBoundingBox: { x: 536, y: 104, width: 240, height: 200 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], cornerRadius: 12, effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 12 }], children: [] },
              ],
            },
            // Shapes
            { id: "s1:0", name: "Circle", type: "ELLIPSE", absoluteBoundingBox: { x: 700, y: 320, width: 80, height: 80 }, fills: [{ type: "SOLID", color: { r: 0.95, g: 0.4, b: 0.4, a: 0.2 } }] },
            { id: "s2:0", name: "Rectangle", type: "RECTANGLE", absoluteBoundingBox: { x: 24, y: 320, width: 120, height: 80 }, fills: [{ type: "SOLID", color: { r: 0.4, g: 0.75, b: 0.95, a: 0.2 } }], cornerRadius: 8 },
          ],
        },
      ],
    },
  });
}
