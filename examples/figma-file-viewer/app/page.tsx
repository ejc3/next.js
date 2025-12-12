"use client";

import React, { useState, useCallback, useMemo } from "react";
import { FigmaParser, createParser } from "../lib/figma-parser";
import type { FigmaFile, FigmaNode, ComponentTreeNode } from "../lib/figma-types";
import { FigmaRenderer } from "../components/FigmaRenderer";
import { ComponentTree, TreeStats, TextContentList } from "../components/ComponentTree";
import { FileUploader, SampleFileLoader } from "../components/FileUploader";

type ViewMode = "render" | "tree" | "text" | "stats";
type SidePanel = "tree" | "properties" | "none";

export default function FigmaViewerPage() {
  const [parser] = useState(() => createParser());
  const [figmaFile, setFigmaFile] = useState<FigmaFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<ViewMode>("render");
  const [sidePanel, setSidePanel] = useState<SidePanel>("tree");
  const [scale, setScale] = useState(1);
  const [showOutlines, setShowOutlines] = useState(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [treeSearchQuery, setTreeSearchQuery] = useState("");
  const [expandAllTree, setExpandAllTree] = useState(false);

  // Parse the file content
  const handleFileLoad = useCallback(
    async (content: string | ArrayBuffer, filename: string) => {
      setIsLoading(true);
      setError(null);

      try {
        let file: FigmaFile;

        if (typeof content === "string") {
          file = await parser.parseJSON(content);
        } else {
          file = await parser.parseFigFile(content);
        }

        setFigmaFile(file);
        setSelectedNodeId(undefined);
        setCurrentPageIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse file");
        setFigmaFile(null);
      } finally {
        setIsLoading(false);
      }
    },
    [parser]
  );

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const handleLoadSample = useCallback(
    (content: string) => {
      handleFileLoad(content, "sample.json");
    },
    [handleFileLoad]
  );

  // Get pages from the document
  const pages = useMemo(() => {
    return parser.getPages();
  }, [figmaFile, parser]);

  // Get current page
  const currentPage = useMemo(() => {
    return pages[currentPageIndex] || null;
  }, [pages, currentPageIndex]);

  // Build component tree
  const componentTree = useMemo(() => {
    if (!figmaFile) return null;
    return parser.buildComponentTree();
  }, [figmaFile, parser]);

  // Get statistics
  const stats = useMemo(() => {
    return parser.getStatistics();
  }, [figmaFile, parser]);

  // Get text content
  const textContent = useMemo(() => {
    return parser.extractTextContent();
  }, [figmaFile, parser]);

  // Get selected node
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !figmaFile) return null;
    return parser.findNodeById(selectedNodeId);
  }, [selectedNodeId, figmaFile, parser]);

  // Handle node selection from tree or canvas
  const handleNodeSelect = useCallback((id: string) => {
    setSelectedNodeId(id);
  }, []);

  const handleNodeClick = useCallback((node: FigmaNode) => {
    setSelectedNodeId(node.id);
  }, []);

  // Reset viewer
  const handleReset = useCallback(() => {
    setFigmaFile(null);
    setError(null);
    setSelectedNodeId(undefined);
    setCurrentPageIndex(0);
  }, []);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <header style={headerStyle}>
        <div style={headerLeftStyle}>
          <h1 style={titleStyle}>Figma File Viewer</h1>
          {figmaFile && (
            <span style={fileNameStyle}>
              {figmaFile.name || "Untitled Document"}
            </span>
          )}
        </div>

        <div style={headerRightStyle}>
          {figmaFile && (
            <>
              <button onClick={handleReset} style={headerButtonStyle}>
                Upload New File
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={mainStyle}>
        {!figmaFile ? (
          // Upload View
          <div style={uploadContainerStyle}>
            <div style={uploadCardStyle}>
              <h2 style={uploadTitleStyle}>Upload a Figma File</h2>
              <p style={uploadDescStyle}>
                Upload a Figma JSON export or .fig file to view and explore its
                contents. You can export JSON from Figma using the API or
                plugins.
              </p>

              <FileUploader
                onFileLoad={handleFileLoad}
                onError={handleError}
                isLoading={isLoading}
              />

              <SampleFileLoader onLoadSample={handleLoadSample} />

              {error && (
                <div style={errorStyle}>
                  <strong>Error:</strong> {error}
                </div>
              )}
            </div>
          </div>
        ) : (
          // Viewer
          <div style={viewerContainerStyle}>
            {/* Toolbar */}
            <div style={toolbarStyle}>
              <div style={toolbarLeftStyle}>
                {/* View Mode Tabs */}
                <div style={tabsStyle}>
                  {(["render", "tree", "text", "stats"] as ViewMode[]).map(
                    (mode) => (
                      <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        style={{
                          ...tabStyle,
                          backgroundColor:
                            viewMode === mode ? "#4f46e5" : "transparent",
                          color: viewMode === mode ? "#fff" : "#6b7280",
                        }}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    )
                  )}
                </div>

                {/* Page Selector */}
                {pages.length > 1 && viewMode === "render" && (
                  <select
                    value={currentPageIndex}
                    onChange={(e) =>
                      setCurrentPageIndex(parseInt(e.target.value))
                    }
                    style={selectStyle}
                  >
                    {pages.map((page, index) => (
                      <option key={page.id} value={index}>
                        {page.name || `Page ${index + 1}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div style={toolbarRightStyle}>
                {viewMode === "render" && (
                  <>
                    {/* Zoom Controls */}
                    <div style={zoomControlsStyle}>
                      <button
                        onClick={() => setScale((s) => Math.max(0.1, s - 0.1))}
                        style={zoomButtonStyle}
                      >
                        −
                      </button>
                      <span style={zoomLabelStyle}>
                        {Math.round(scale * 100)}%
                      </span>
                      <button
                        onClick={() => setScale((s) => Math.min(3, s + 0.1))}
                        style={zoomButtonStyle}
                      >
                        +
                      </button>
                      <button
                        onClick={() => setScale(1)}
                        style={zoomButtonStyle}
                      >
                        Reset
                      </button>
                    </div>

                    {/* Show Outlines Toggle */}
                    <label style={toggleLabelStyle}>
                      <input
                        type="checkbox"
                        checked={showOutlines}
                        onChange={(e) => setShowOutlines(e.target.checked)}
                        style={checkboxStyle}
                      />
                      Show Outlines
                    </label>

                    {/* Side Panel Toggle */}
                    <div style={sidePanelToggleStyle}>
                      <button
                        onClick={() =>
                          setSidePanel(sidePanel === "tree" ? "none" : "tree")
                        }
                        style={{
                          ...sidePanelButtonStyle,
                          backgroundColor:
                            sidePanel === "tree" ? "#e0e7ff" : "transparent",
                        }}
                      >
                        Tree
                      </button>
                      <button
                        onClick={() =>
                          setSidePanel(
                            sidePanel === "properties" ? "none" : "properties"
                          )
                        }
                        style={{
                          ...sidePanelButtonStyle,
                          backgroundColor:
                            sidePanel === "properties"
                              ? "#e0e7ff"
                              : "transparent",
                        }}
                      >
                        Properties
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div style={contentAreaStyle}>
              {viewMode === "render" && (
                <>
                  {/* Canvas */}
                  <div
                    style={{
                      ...canvasContainerStyle,
                      marginRight: sidePanel !== "none" ? 320 : 0,
                    }}
                  >
                    <div style={canvasStyle}>
                      {currentPage && (
                        <FigmaRenderer
                          node={currentPage}
                          scale={scale}
                          selectedId={selectedNodeId}
                          onNodeClick={handleNodeClick}
                          showOutlines={showOutlines}
                        />
                      )}
                    </div>
                  </div>

                  {/* Side Panel */}
                  {sidePanel !== "none" && (
                    <div style={sidePanelStyle}>
                      {sidePanel === "tree" && (
                        <div style={treePanelStyle}>
                          <div style={treePanelHeaderStyle}>
                            <h3 style={treePanelTitleStyle}>Component Tree</h3>
                            <div style={treeControlsStyle}>
                              <input
                                type="text"
                                placeholder="Search..."
                                value={treeSearchQuery}
                                onChange={(e) =>
                                  setTreeSearchQuery(e.target.value)
                                }
                                style={treeSearchStyle}
                              />
                              <button
                                onClick={() => setExpandAllTree(!expandAllTree)}
                                style={expandButtonStyle}
                              >
                                {expandAllTree ? "Collapse" : "Expand"}
                              </button>
                            </div>
                          </div>
                          <ComponentTree
                            tree={componentTree}
                            selectedId={selectedNodeId}
                            onNodeSelect={handleNodeSelect}
                            expandAll={expandAllTree}
                            searchQuery={treeSearchQuery}
                          />
                        </div>
                      )}

                      {sidePanel === "properties" && (
                        <NodeProperties node={selectedNode} />
                      )}
                    </div>
                  )}
                </>
              )}

              {viewMode === "tree" && (
                <div style={fullPanelStyle}>
                  <div style={treePanelHeaderStyle}>
                    <h3 style={treePanelTitleStyle}>Full Component Tree</h3>
                    <div style={treeControlsStyle}>
                      <input
                        type="text"
                        placeholder="Search nodes..."
                        value={treeSearchQuery}
                        onChange={(e) => setTreeSearchQuery(e.target.value)}
                        style={treeSearchStyle}
                      />
                      <button
                        onClick={() => setExpandAllTree(!expandAllTree)}
                        style={expandButtonStyle}
                      >
                        {expandAllTree ? "Collapse All" : "Expand All"}
                      </button>
                    </div>
                  </div>
                  <ComponentTree
                    tree={componentTree}
                    selectedId={selectedNodeId}
                    onNodeSelect={handleNodeSelect}
                    expandAll={expandAllTree}
                    searchQuery={treeSearchQuery}
                  />
                </div>
              )}

              {viewMode === "text" && (
                <div style={fullPanelStyle}>
                  <h3 style={treePanelTitleStyle}>Text Content</h3>
                  <TextContentList
                    textNodes={textContent}
                    onNodeSelect={handleNodeSelect}
                  />
                </div>
              )}

              {viewMode === "stats" && (
                <div style={statsPanelStyle}>
                  <TreeStats stats={stats} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Node Properties Panel
 */
function NodeProperties({ node }: { node: FigmaNode | null }) {
  if (!node) {
    return (
      <div style={propertiesPanelStyle}>
        <p style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>
          Select a node to view its properties
        </p>
      </div>
    );
  }

  return (
    <div style={propertiesPanelStyle}>
      <h3 style={propertiesTitleStyle}>{node.name}</h3>
      <div style={propertiesContentStyle}>
        <PropertyRow label="ID" value={node.id} />
        <PropertyRow label="Type" value={node.type} />
        <PropertyRow
          label="Visible"
          value={node.visible !== false ? "Yes" : "No"}
        />

        {"absoluteBoundingBox" in node && node.absoluteBoundingBox && (
          <>
            <PropertySection title="Bounding Box" />
            <PropertyRow label="X" value={node.absoluteBoundingBox.x} />
            <PropertyRow label="Y" value={node.absoluteBoundingBox.y} />
            <PropertyRow label="Width" value={node.absoluteBoundingBox.width} />
            <PropertyRow
              label="Height"
              value={node.absoluteBoundingBox.height}
            />
          </>
        )}

        {"fills" in node && node.fills && node.fills.length > 0 && (
          <>
            <PropertySection title="Fills" />
            {node.fills.map((fill, i) => (
              <PropertyRow key={i} label={`Fill ${i + 1}`} value={fill.type} />
            ))}
          </>
        )}

        {"layoutMode" in node && node.layoutMode && (
          <>
            <PropertySection title="Auto Layout" />
            <PropertyRow label="Direction" value={node.layoutMode} />
            {"itemSpacing" in node && (
              <PropertyRow label="Gap" value={node.itemSpacing} />
            )}
          </>
        )}

        {"characters" in node && (
          <>
            <PropertySection title="Text Content" />
            <div style={textPreviewStyle}>
              {(node as any).characters || "(empty)"}
            </div>
          </>
        )}

        {"style" in node && (node as any).style && (
          <>
            <PropertySection title="Text Style" />
            <PropertyRow
              label="Font"
              value={(node as any).style.fontFamily}
            />
            <PropertyRow
              label="Size"
              value={`${(node as any).style.fontSize}px`}
            />
            <PropertyRow
              label="Weight"
              value={(node as any).style.fontWeight}
            />
          </>
        )}
      </div>
    </div>
  );
}

function PropertySection({ title }: { title: string }) {
  return (
    <div style={propertySectionStyle}>
      <strong>{title}</strong>
    </div>
  );
}

function PropertyRow({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <div style={propertyRowStyle}>
      <span style={propertyLabelStyle}>{label}</span>
      <span style={propertyValueStyle}>
        {value !== undefined ? String(value) : "-"}
      </span>
    </div>
  );
}

// Styles
const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  backgroundColor: "#f3f4f6",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 24px",
  backgroundColor: "#fff",
  borderBottom: "1px solid #e5e7eb",
  zIndex: 10,
};

const headerLeftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const headerRightStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
  color: "#1f2937",
};

const fileNameStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#6b7280",
  padding: "4px 12px",
  backgroundColor: "#f3f4f6",
  borderRadius: 4,
};

const headerButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  backgroundColor: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
};

const uploadContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 24,
};

const uploadCardStyle: React.CSSProperties = {
  maxWidth: 500,
  width: "100%",
  padding: 32,
  backgroundColor: "#fff",
  borderRadius: 12,
  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
};

const uploadTitleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 24,
  fontWeight: 600,
  color: "#1f2937",
};

const uploadDescStyle: React.CSSProperties = {
  margin: "0 0 24px",
  fontSize: 14,
  color: "#6b7280",
  lineHeight: 1.6,
};

const errorStyle: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 6,
  color: "#dc2626",
  fontSize: 13,
};

const viewerContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 16px",
  backgroundColor: "#fff",
  borderBottom: "1px solid #e5e7eb",
};

const toolbarLeftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const toolbarRightStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const tabsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 4,
  backgroundColor: "#f3f4f6",
  borderRadius: 6,
};

const tabStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  transition: "all 0.15s ease",
};

const selectStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  backgroundColor: "#fff",
};

const zoomControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const zoomButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  backgroundColor: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

const zoomLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#374151",
  minWidth: 50,
  textAlign: "center",
};

const toggleLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  color: "#374151",
  cursor: "pointer",
};

const checkboxStyle: React.CSSProperties = {
  cursor: "pointer",
};

const sidePanelToggleStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 4,
  backgroundColor: "#f3f4f6",
  borderRadius: 6,
};

const sidePanelButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  color: "#374151",
};

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  overflow: "hidden",
  position: "relative",
};

const canvasContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  backgroundColor: "#e5e7eb",
  transition: "margin-right 0.2s ease",
};

const canvasStyle: React.CSSProperties = {
  padding: 32,
  minHeight: "100%",
};

const sidePanelStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 0,
  bottom: 0,
  width: 320,
  backgroundColor: "#fff",
  borderLeft: "1px solid #e5e7eb",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const treePanelStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const treePanelHeaderStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #e5e7eb",
};

const treePanelTitleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 14,
  fontWeight: 600,
  color: "#1f2937",
};

const treeControlsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const treeSearchStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 12,
};

const expandButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  backgroundColor: "#fff",
  cursor: "pointer",
  fontSize: 12,
};

const fullPanelStyle: React.CSSProperties = {
  flex: 1,
  padding: 16,
  overflow: "auto",
  backgroundColor: "#fff",
};

const statsPanelStyle: React.CSSProperties = {
  flex: 1,
  padding: 24,
  overflow: "auto",
};

const propertiesPanelStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
};

const propertiesTitleStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px 16px",
  fontSize: 14,
  fontWeight: 600,
  color: "#1f2937",
  borderBottom: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
};

const propertiesContentStyle: React.CSSProperties = {
  padding: "8px 0",
};

const propertySectionStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 12,
  color: "#6b7280",
  backgroundColor: "#f9fafb",
  marginTop: 8,
};

const propertyRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 16px",
  fontSize: 12,
};

const propertyLabelStyle: React.CSSProperties = {
  width: 80,
  color: "#6b7280",
};

const propertyValueStyle: React.CSSProperties = {
  flex: 1,
  color: "#1f2937",
  fontFamily: "monospace",
};

const textPreviewStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 12,
  color: "#374151",
  backgroundColor: "#f3f4f6",
  margin: "0 16px 8px",
  borderRadius: 4,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
