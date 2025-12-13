# Figma File Viewer

A Next.js application that renders Figma files by parsing their JSON structure and converting them to equivalent React components.

## Features

- **File Upload**: Upload Figma JSON exports or .fig files
- **Visual Rendering**: Converts Figma nodes to React components with accurate styling
- **Component Tree**: Hierarchical view of all document elements with search functionality
- **Text Content Extraction**: View and search all text content in the document
- **Document Statistics**: Overview of node counts and types
- **Properties Panel**: Inspect selected node properties
- **Zoom Controls**: Scale the rendered view
- **Multi-page Support**: Navigate between pages in multi-page documents

## Supported Figma Elements

The viewer supports rendering the following Figma node types:

- **Document** - Root document container
- **Canvas** - Pages within the document
- **Frame** - Frames with auto-layout support
- **Group** - Grouped elements
- **Rectangle** - Rectangle shapes with corner radius
- **Ellipse** - Circles and ellipses
- **Line** - Line elements
- **Vector** - Complex vector shapes (rendered as SVG)
- **Text** - Text with font styling
- **Component** - Figma components
- **Instance** - Component instances
- **Boolean Operations** - Union, subtract, intersect, exclude

### Styling Support

- Solid fills and gradients (linear, radial)
- Strokes with weight and color
- Corner radius (individual or uniform)
- Drop shadows and inner shadows
- Layer and background blur
- Opacity and blend modes
- Auto-layout with padding, gap, and alignment

## Getting Started

1. Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

2. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How to Export Figma Files

### Using Figma API

You can export Figma files as JSON using the [Figma REST API](https://www.figma.com/developers/api):

```bash
curl -H "X-Figma-Token: YOUR_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/FILE_KEY" > figma-file.json
```

### Using Figma Plugins

Several Figma plugins can export files to JSON format:

1. Open your Figma file
2. Go to Plugins > Search for "JSON Export" or similar
3. Run the plugin and download the JSON file
4. Upload the JSON file to this viewer

### Sample Document

If you don't have a Figma file, click "Load Sample Document" to see an example elementary school lesson plan design.

## Project Structure

```
figma-file-viewer/
├── app/
│   ├── page.tsx          # Main viewer page
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles
├── components/
│   ├── FigmaRenderer.tsx # Renders Figma nodes as React
│   ├── ComponentTree.tsx # Tree view and statistics
│   └── FileUploader.tsx  # File upload component
├── lib/
│   ├── figma-types.ts    # TypeScript type definitions
│   └── figma-parser.ts   # Figma file parser utilities
├── package.json
├── tsconfig.json
└── next.config.ts
```

## API Reference

### FigmaParser

```typescript
import { FigmaParser, createParser } from "./lib/figma-parser";

const parser = createParser();

// Parse JSON string
const file = await parser.parseJSON(jsonString);

// Parse .fig file (ArrayBuffer)
const file = await parser.parseFigFile(arrayBuffer);

// Build component tree
const tree = parser.buildComponentTree();

// Get pages
const pages = parser.getPages();

// Find node by ID
const node = parser.findNodeById("1:234");

// Get document statistics
const stats = parser.getStatistics();

// Extract all text content
const textNodes = parser.extractTextContent();
```

### FigmaRenderer

```tsx
import { FigmaRenderer } from "./components/FigmaRenderer";

<FigmaRenderer
  node={figmaNode}           // The Figma node to render
  scale={1}                  // Zoom scale (default: 1)
  selectedId="1:234"         // ID of selected node
  onNodeClick={(node) => {}} // Click handler
  renderMode="absolute"      // "absolute" or "flow"
  showOutlines={false}       // Show element outlines
/>
```

### ComponentTree

```tsx
import { ComponentTree, TreeStats, TextContentList } from "./components/ComponentTree";

<ComponentTree
  tree={componentTreeNode}   // Tree structure from parser
  selectedId="1:234"         // ID of selected node
  onNodeSelect={(id) => {}}  // Selection handler
  expandAll={false}          // Expand all nodes
  searchQuery=""             // Filter nodes by search
/>

<TreeStats stats={stats} />

<TextContentList
  textNodes={textNodes}
  onNodeSelect={(id) => {}}
/>
```

## Limitations

- **Images**: Image fills require the actual image data which isn't included in JSON exports
- **Fonts**: Custom fonts may not render correctly if not available locally
- **Complex Vectors**: Some complex vector paths may not render perfectly
- **Prototypes**: Prototype interactions are parsed and indicated visually (⚡ icon on hover), but full interactive navigation is not yet implemented
- **Plugins**: Plugin data is preserved but not interpreted

## Learn More

- [Figma API Documentation](https://www.figma.com/developers/api)
- [Figma File Format](https://www.figma.com/plugin-docs/api/nodes/)
- [Next.js Documentation](https://nextjs.org/docs)
