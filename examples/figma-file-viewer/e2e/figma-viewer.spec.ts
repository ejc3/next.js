import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Helper to load fixture files
function loadFixture(name: string): string {
  const fixturePath = path.join(__dirname, "fixtures", name);
  return fs.readFileSync(fixturePath, "utf-8");
}

// Helper to upload a JSON file to the viewer
async function uploadJsonFile(page: Page, filename: string, content: string) {
  // Create a temporary file buffer
  const buffer = Buffer.from(content, "utf-8");

  // Get the file input and upload
  const fileInput = page.locator('input[type="file"]');

  // Create a file and upload it
  await fileInput.setInputFiles({
    name: filename,
    mimeType: "application/json",
    buffer: buffer,
  });
}


test.describe("Figma File Viewer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test.describe("Initial Load", () => {
    test("should display the upload interface on initial load", async ({ page }) => {
      // Check main title
      await expect(page.locator("h1")).toContainText("Figma File Viewer");

      // Check upload area exists
      await expect(page.locator(".file-uploader")).toBeVisible();

      // Check upload text
      await expect(page.getByText("Upload Figma File")).toBeVisible();
      await expect(page.getByText("Drag and drop or click to select")).toBeVisible();

      // Check sample loader exists
      await expect(page.getByText("Load Sample Document")).toBeVisible();
    });

    test("should have correct page title", async ({ page }) => {
      await expect(page).toHaveTitle("Figma File Viewer");
    });
  });

  test.describe("Sample Document", () => {
    test("should load the sample document when clicking the button", async ({ page }) => {
      // Click the sample button
      await page.getByText("Load Sample Document").click();

      // Wait for the viewer to load
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check that the document name is displayed
      await expect(page.getByText("Sample Figma Document")).toBeVisible();

      // Check that view mode tabs are visible
      await expect(page.getByRole("button", { name: "Render" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Tree" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Stats" })).toBeVisible();
    });

    test("should render the sample lesson plan content", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check for lesson plan text content in the rendered view
      await expect(page.locator(".figma-text").filter({ hasText: "Elementary School Planner" })).toBeVisible();
      await expect(page.locator(".figma-text").filter({ hasText: "Weekly Lesson Plan" })).toBeVisible();
    });

    test("should display component tree for sample document", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Click tree button in side panel
      await page.getByRole("button", { name: "Tree" }).first().click();

      // Check tree is visible
      await expect(page.locator(".component-tree")).toBeVisible();

      // Check for DOCUMENT type label in tree (exact match)
      await expect(page.locator(".component-tree").getByText("DOCUMENT", { exact: true })).toBeVisible();
    });
  });

  test.describe("File Upload - Simple UI Kit", () => {
    test("should upload and render the simple UI kit", async ({ page }) => {
      const uiKitJson = loadFixture("simple-ui-kit.json");
      await uploadJsonFile(page, "simple-ui-kit.json", uiKitJson);

      // Wait for rendering
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check document name
      await expect(page.getByText("Simple UI Kit")).toBeVisible();

      // Check that components are rendered
      await expect(page.locator(".figma-component")).toHaveCount(4);
    });

    test("should display correct text content from UI kit", async ({ page }) => {
      const uiKitJson = loadFixture("simple-ui-kit.json");
      await uploadJsonFile(page, "simple-ui-kit.json", uiKitJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check for button labels
      await expect(page.locator(".figma-text").filter({ hasText: "Click Me" })).toBeVisible();
      await expect(page.locator(".figma-text").filter({ hasText: "Cancel" })).toBeVisible();

      // Check for input placeholder
      await expect(page.locator(".figma-text").filter({ hasText: "Enter your email..." })).toBeVisible();

      // Check for card content
      await expect(page.locator(".figma-text").filter({ hasText: "Card Title" })).toBeVisible();
    });

    test("should show statistics for UI kit", async ({ page }) => {
      const uiKitJson = loadFixture("simple-ui-kit.json");
      await uploadJsonFile(page, "simple-ui-kit.json", uiKitJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Navigate to stats view
      await page.getByRole("button", { name: "Stats" }).click();

      // Check statistics are displayed
      await expect(page.getByText("Document Statistics")).toBeVisible();
      await expect(page.getByText("Total Nodes")).toBeVisible();
      await expect(page.getByText("Components")).toBeVisible();
    });
  });

  test.describe("File Upload - Multi-Page Design", () => {
    test("should upload and render multi-page design", async ({ page }) => {
      const multiPageJson = loadFixture("multi-page-design.json");
      await uploadJsonFile(page, "multi-page-design.json", multiPageJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check document name
      await expect(page.getByText("Multi-Page Website Design")).toBeVisible();
    });

    test("should show page selector for multi-page documents", async ({ page }) => {
      const multiPageJson = loadFixture("multi-page-design.json");
      await uploadJsonFile(page, "multi-page-design.json", multiPageJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check that page selector exists
      const pageSelector = page.locator("select");
      await expect(pageSelector).toBeVisible();

      // Check all pages are in the selector
      await expect(pageSelector.locator("option")).toHaveCount(3);
    });

    test("should switch between pages", async ({ page }) => {
      const multiPageJson = loadFixture("multi-page-design.json");
      await uploadJsonFile(page, "multi-page-design.json", multiPageJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Home page should be visible initially
      await expect(page.locator(".figma-text").filter({ hasText: "Welcome to Our Platform" })).toBeVisible();

      // Switch to About page
      await page.locator("select").selectOption({ label: "About Page" });

      // About page content should now be visible
      await expect(page.locator(".figma-text").filter({ hasText: "About Us" })).toBeVisible();

      // Switch to Contact page
      await page.locator("select").selectOption({ label: "Contact Page" });

      // Contact page content should now be visible
      await expect(page.locator(".figma-text").filter({ hasText: "Get in Touch" })).toBeVisible();
    });

    test("should render gradient backgrounds", async ({ page }) => {
      const multiPageJson = loadFixture("multi-page-design.json");
      await uploadJsonFile(page, "multi-page-design.json", multiPageJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Hero section should have gradient background
      const heroSection = page.locator('[data-figma-name="Hero Section"]');
      await expect(heroSection).toBeVisible();

      // Check that background contains gradient
      const bgStyle = await heroSection.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.background || style.backgroundColor;
      });

      expect(bgStyle).toContain("gradient");
    });
  });

  test.describe("File Upload - Shapes and Vectors", () => {
    test("should upload and render shapes", async ({ page }) => {
      const shapesJson = loadFixture("shapes-and-vectors.json");
      await uploadJsonFile(page, "shapes-and-vectors.json", shapesJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check document name
      await expect(page.getByText("Shapes and Vectors Demo")).toBeVisible();
    });

    test("should render rectangles with different corner radii", async ({ page }) => {
      const shapesJson = loadFixture("shapes-and-vectors.json");
      await uploadJsonFile(page, "shapes-and-vectors.json", shapesJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check rectangles are rendered
      const rectangles = page.locator(".figma-rectangle");
      await expect(rectangles.first()).toBeVisible();
    });

    test("should render ellipses/circles", async ({ page }) => {
      const shapesJson = loadFixture("shapes-and-vectors.json");
      await uploadJsonFile(page, "shapes-and-vectors.json", shapesJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check ellipses are rendered with border-radius: 50%
      const ellipses = page.locator(".figma-ellipse");
      await expect(ellipses.first()).toBeVisible();

      const borderRadius = await ellipses.first().evaluate((el) => {
        return window.getComputedStyle(el).borderRadius;
      });

      expect(borderRadius).toBe("50%");
    });

    test("should not render hidden elements", async ({ page }) => {
      const shapesJson = loadFixture("shapes-and-vectors.json");
      await uploadJsonFile(page, "shapes-and-vectors.json", shapesJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Hidden element should not be visible
      const hiddenElement = page.locator('[data-figma-name="Hidden Element"]');
      await expect(hiddenElement).not.toBeVisible();
    });

    test("should apply opacity to elements", async ({ page }) => {
      const shapesJson = loadFixture("shapes-and-vectors.json");
      await uploadJsonFile(page, "shapes-and-vectors.json", shapesJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check element with 50% opacity exists and has correct opacity
      const halfOpacityElement = page.locator('[data-figma-name="Opacity 50%"]');

      // Scroll to element (it may be below the fold)
      await halfOpacityElement.scrollIntoViewIfNeeded();

      // Check the element exists and has correct opacity via attribute
      await expect(halfOpacityElement).toHaveCount(1);
      await expect(halfOpacityElement).toHaveCSS("opacity", "0.5");
    });
  });

  test.describe("Zoom Controls", () => {
    test("should zoom in when clicking + button", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Get initial zoom level
      const zoomLabel = page.locator("text=100%");
      await expect(zoomLabel).toBeVisible();

      // Click zoom in
      await page.getByRole("button", { name: "+" }).click();

      // Check zoom increased
      await expect(page.locator("text=110%")).toBeVisible();
    });

    test("should zoom out when clicking - button", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Click zoom out
      await page.getByRole("button", { name: "−" }).click();

      // Check zoom decreased
      await expect(page.locator("text=90%")).toBeVisible();
    });

    test("should reset zoom when clicking Reset button", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Zoom in a few times
      await page.getByRole("button", { name: "+" }).click();
      await page.getByRole("button", { name: "+" }).click();
      await expect(page.locator("text=120%")).toBeVisible();

      // Reset
      await page.getByRole("button", { name: "Reset" }).click();
      await expect(page.locator("text=100%")).toBeVisible();
    });
  });

  test.describe("Component Tree View", () => {
    test("should display full tree view", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Switch to tree view
      await page.getByRole("button", { name: "Tree" }).first().click();

      // Check full tree is visible
      await expect(page.getByText("Full Component Tree")).toBeVisible();
    });

    test("should filter tree nodes by search", async ({ page }) => {
      const uiKitJson = loadFixture("simple-ui-kit.json");
      await uploadJsonFile(page, "simple-ui-kit.json", uiKitJson);

      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Switch to tree view
      await page.getByRole("button", { name: "Tree" }).first().click();

      // Search for "Button"
      const searchInput = page.locator('input[placeholder="Search nodes..."]');
      await searchInput.fill("Button");

      // Should show button components, filter out others
      await expect(page.getByText("Button/Primary")).toBeVisible();
      await expect(page.getByText("Button/Secondary")).toBeVisible();
    });

    test("should expand all nodes when clicking Expand All", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Switch to tree view
      await page.getByRole("button", { name: "Tree" }).first().click();

      // Click expand all
      await page.getByRole("button", { name: "Expand All" }).click();

      // Should change to Collapse All
      await expect(page.getByRole("button", { name: "Collapse All" })).toBeVisible();
    });
  });

  test.describe("Text Content View", () => {
    test("should display all text content", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Switch to text view
      await page.getByRole("button", { name: "Text" }).click();

      // Check text content header
      await expect(page.getByText("Text Content")).toBeVisible();

      // Should show text nodes
      await expect(page.getByText(/text node/i)).toBeVisible();
    });

    test("should search text content", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Switch to text view
      await page.getByRole("button", { name: "Text" }).click();

      // Search for specific text
      const searchInput = page.locator('input[placeholder="Search text content..."]');
      await searchInput.fill("Math");

      // Should filter results
      await expect(page.getByText("Math - Addition")).toBeVisible();
    });
  });

  test.describe("Node Selection", () => {
    test("should highlight selected node in canvas", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Click on a frame in the canvas
      const frame = page.locator(".figma-frame").first();
      await frame.click();

      // Wait for selection to be applied (outline contains "solid" and blue color)
      await expect(frame).toHaveCSS("outline-style", "solid", { timeout: 5000 });
      await expect(frame).toHaveCSS("outline-color", "rgb(0, 102, 255)");
    });

    test("should show properties panel for selected node", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Open properties panel
      await page.getByRole("button", { name: "Properties" }).click();

      // Click on a text node
      const textNode = page.locator(".figma-text").first();
      await textNode.click();

      // Properties panel should show node info (labels in the PropertyRow component)
      await expect(page.locator("text=ID").first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator("text=Type").first()).toBeVisible();
    });
  });

  test.describe("Show Outlines Toggle", () => {
    test("should toggle element outlines", async ({ page }) => {
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Check the "Show Outlines" checkbox
      const checkbox = page.locator('input[type="checkbox"]');
      await checkbox.check();

      // Frames should have dashed outlines when Show Outlines is enabled
      const frame = page.locator(".figma-frame").first();
      await expect(frame).toHaveCSS("outline-style", "dashed", { timeout: 5000 });
    });
  });

  test.describe("Error Handling", () => {
    test("should show error for invalid JSON", async ({ page }) => {
      await uploadJsonFile(page, "invalid.json", "this is not valid json {{{");

      // Should show error message
      await expect(page.getByText("Error:")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Invalid JSON/i)).toBeVisible();
    });

    test("should show error for JSON without document property", async ({ page }) => {
      await uploadJsonFile(page, "no-document.json", '{"name": "test"}');

      // Should show error message
      await expect(page.getByText("Error:")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/missing document/i)).toBeVisible();
    });
  });

  test.describe("Upload New File", () => {
    test("should allow uploading a new file after one is loaded", async ({ page }) => {
      // Load first file
      await page.getByText("Load Sample Document").click();
      await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

      // Click "Upload New File" button
      await page.getByRole("button", { name: "Upload New File" }).click();

      // Should show upload interface again
      await expect(page.getByText("Upload Figma File")).toBeVisible();
      await expect(page.locator(".file-uploader")).toBeVisible();
    });
  });
});

test.describe("Visual Regression Tests", () => {
  test("upload interface screenshot", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".file-uploader")).toBeVisible();

    await expect(page).toHaveScreenshot("upload-interface.png", {
      maxDiffPixels: 200,
    });
  });

  test("sample document rendered screenshot", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Load Sample Document").click();
    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Wait for animations to complete
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("sample-document.png", {
      maxDiffPixels: 500,
    });
  });

  test("UI kit rendered screenshot", async ({ page }) => {
    await page.goto("/");
    const uiKitJson = loadFixture("simple-ui-kit.json");
    await uploadJsonFile(page, "simple-ui-kit.json", uiKitJson);
    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("ui-kit.png", {
      maxDiffPixels: 500,
    });
  });

  test("shapes demo rendered screenshot", async ({ page }) => {
    await page.goto("/");
    const shapesJson = loadFixture("shapes-and-vectors.json");
    await uploadJsonFile(page, "shapes-and-vectors.json", shapesJson);
    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("shapes-demo.png", {
      maxDiffPixels: 500,
    });
  });

  test("tree view screenshot", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Load Sample Document").click();
    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Switch to tree view
    await page.getByRole("button", { name: "Tree" }).first().click();
    await expect(page.getByText("Full Component Tree")).toBeVisible();

    await expect(page).toHaveScreenshot("tree-view.png", {
      maxDiffPixels: 300,
    });
  });

  test("stats view screenshot", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Load Sample Document").click();
    await expect(page.locator(".figma-canvas")).toBeVisible({ timeout: 10000 });

    // Switch to stats view
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.getByText("Document Statistics")).toBeVisible();

    await expect(page).toHaveScreenshot("stats-view.png", {
      maxDiffPixels: 300,
    });
  });
});

/**
 * Tests using real .fig files downloaded from the internet
 * Source: https://github.com/parthivdholaria/Figma-IHCI-Project
 */
test.describe("Real .fig File Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should upload and parse prototype-group-26.fig", async ({ page }) => {
    // Upload the real .fig file
    const fixturePath = path.join(__dirname, "fixtures", "prototype-group-26.fig");
    const buffer = fs.readFileSync(fixturePath);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "prototype-group-26.fig",
      mimeType: "application/octet-stream",
      buffer: buffer,
    });

    // Should render without errors (allow more time for parsing)
    await expect(page.locator(".figma-canvas, .figma-document")).toBeVisible({ timeout: 60000 });

    // Should have document stats
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.getByText("Document Statistics")).toBeVisible();
    await expect(page.getByText("Total Nodes")).toBeVisible();
  });

  test("should display component tree for real .fig file", async ({ page }) => {
    const fixturePath = path.join(__dirname, "fixtures", "prototype-group-26.fig");
    const buffer = fs.readFileSync(fixturePath);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "prototype-group-26.fig",
      mimeType: "application/octet-stream",
      buffer: buffer,
    });

    await expect(page.locator(".figma-canvas, .figma-document")).toBeVisible({ timeout: 60000 });

    // Switch to tree view
    await page.getByRole("button", { name: "Tree" }).first().click();
    await expect(page.getByText("Full Component Tree")).toBeVisible();

    // Should have at least one node in tree
    const nodeCount = await page.locator(".component-tree .tree-node").count();
    expect(nodeCount).toBeGreaterThan(0);
  });
});
