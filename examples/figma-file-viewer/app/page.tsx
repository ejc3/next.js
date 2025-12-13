"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { FigmaParser, createParser } from "../lib/figma-parser";
import type { FigmaFile, FigmaNode, ComponentTreeNode } from "../lib/figma-types";
import { FigmaRenderer } from "../components/FigmaRenderer";
import { ComponentTree, TreeStats, TextContentList } from "../components/ComponentTree";
import { FileUploader, SampleFileLoader } from "../components/FileUploader";
import ErrorBoundary from "../components/ErrorBoundary";

type ViewMode = "render" | "tree" | "text" | "stats" | "prototype";
type SidePanel = "tree" | "properties" | "none";

// Map Figma easing types to CSS timing functions
function mapFigmaEasingToCSS(easingType?: string): string {
  switch (easingType) {
    case "LINEAR": return "linear";
    case "EASE_IN": return "ease-in";
    case "EASE_OUT": return "ease-out";
    case "EASE_IN_AND_OUT": return "ease-in-out";
    case "EASE_IN_BACK": return "cubic-bezier(0.6, -0.28, 0.735, 0.045)";
    case "EASE_OUT_BACK": return "cubic-bezier(0.175, 0.885, 0.32, 1.275)";
    case "EASE_IN_AND_OUT_BACK": return "cubic-bezier(0.68, -0.55, 0.265, 1.55)";
    case "GENTLE": return "cubic-bezier(0.4, 0, 0.2, 1)";
    case "QUICK": return "cubic-bezier(0.4, 0, 0.6, 1)";
    case "BOUNCY": return "cubic-bezier(0.68, -0.55, 0.265, 1.55)";
    case "SLOW": return "cubic-bezier(0.4, 0, 0.2, 1)";
    case "IN_CUBIC": return "cubic-bezier(0.55, 0.055, 0.675, 0.19)";
    case "OUT_CUBIC": return "cubic-bezier(0.215, 0.61, 0.355, 1)";
    default: return "ease-in-out";
  }
}

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
  const [prototypeFrameId, setPrototypeFrameId] = useState<string | undefined>();
  const [prototypeTransition, setPrototypeTransition] = useState<{
    type: string;
    direction?: string;
    isAnimating: boolean;
    duration?: number;
    easing?: string;
  } | null>(null);
  const [overlayState, setOverlayState] = useState<{
    nodeId: string;
    position?: { x: number; y: number };
    transitionType?: string;
    duration?: number;
    easing?: string;
  } | null>(null);
  // SWAP state: maps original node IDs to their swapped component IDs
  const [swapState, setSwapState] = useState<Map<string, string>>(new Map());

  // Refs for timeout cleanup to prevent memory leaks
  const transitionTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Stable callback for findNodeById to prevent re-renders
  const findNodeByIdCallback = useCallback(
    (id: string) => parser.findNodeById(id),
    [parser]
  );

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

  // Get prototype starting frame and device settings
  const prototypeInfo = useMemo(() => {
    if (!currentPage || !("children" in currentPage)) return null;

    // Find prototype device settings (usually on the canvas node)
    const prototypeDevice = (currentPage as any).prototypeDevice;

    // Find prototype starting point or first top-level frame
    const frames = ((currentPage as any).children || []).filter(
      (child: FigmaNode) => child.type === "FRAME" || child.type === "COMPONENT"
    );

    // Look for prototypeStartNodeID
    const startNodeId = (currentPage as any).prototypeStartNodeID;
    let startFrame = frames.find((f: FigmaNode) => f.id === startNodeId) || frames[0];

    return {
      device: prototypeDevice,
      frames,
      startFrame,
      startFrameId: startFrame?.id,
    };
  }, [currentPage]);

  // Get current prototype frame
  const currentPrototypeFrame = useMemo(() => {
    if (!prototypeFrameId) {
      return prototypeInfo?.startFrame || null;
    }
    return parser.findNodeById(prototypeFrameId);
  }, [prototypeFrameId, prototypeInfo, parser]);

  // Get overlay frame
  const overlayFrame = useMemo(() => {
    if (!overlayState?.nodeId) return null;
    return parser.findNodeById(overlayState.nodeId);
  }, [overlayState?.nodeId, parser]);

  // Close overlay handler
  const handleCloseOverlay = useCallback(() => {
    setOverlayState(null);
  }, []);

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

  // Handle prototype navigation
  const handlePrototypeNavigate = useCallback(
    (targetNodeId: string, transitionType?: string, transitionDuration?: number, easingType?: string, navigationType?: string, sourceNodeId?: string) => {
      // In prototype mode, switch to the target frame with transition
      if (viewMode === "prototype") {
        // Handle OVERLAY navigation
        if (navigationType === "OVERLAY") {
          const duration = transitionDuration ?? 300;
          const easing = mapFigmaEasingToCSS(easingType);
          setOverlayState({
            nodeId: targetNodeId,
            transitionType: transitionType || "DISSOLVE",
            duration,
            easing,
          });
          return;
        }

        // Handle SWAP navigation - swap a component instance in place
        if (navigationType === "SWAP" && sourceNodeId) {
          setSwapState((prev) => {
            const newState = new Map(prev);
            newState.set(sourceNodeId, targetNodeId);
            return newState;
          });
          return;
        }

        // Handle CLOSE overlay
        if (navigationType === "CLOSE" || navigationType === "BACK") {
          if (overlayState) {
            setOverlayState(null);
            return;
          }
        }

        // Determine transition type and duration
        const transition = transitionType || "INSTANT";
        // Use provided duration or default (300ms for animated, 0 for instant)
        const duration = transition === "INSTANT" ? 0 : (transitionDuration ?? 300);
        // Map Figma easing to CSS timing function
        const easing = mapFigmaEasingToCSS(easingType);

        if (duration > 0) {
          // Clear any existing transition timeouts
          transitionTimeoutsRef.current.forEach(clearTimeout);
          transitionTimeoutsRef.current = [];

          // Start transition animation with custom duration and easing
          setPrototypeTransition({
            type: transition,
            direction: transition.includes("IN") ? "in" : transition.includes("OUT") ? "out" : undefined,
            isAnimating: true,
            duration,
            easing,
          });

          // Change frame partway through for some transitions
          if (transition === "DISSOLVE" || transition === "SMART_ANIMATE") {
            // Fade out, then change, then fade in
            const frameChangeTimeout = setTimeout(() => {
              setPrototypeFrameId(targetNodeId);
            }, duration / 2);
            transitionTimeoutsRef.current.push(frameChangeTimeout);
          } else {
            // Slide animations - change immediately
            setPrototypeFrameId(targetNodeId);
          }

          // End transition
          const endTransitionTimeout = setTimeout(() => {
            setPrototypeTransition(null);
          }, duration);
          transitionTimeoutsRef.current.push(endTransitionTimeout);
        } else {
          // Instant transition
          setPrototypeFrameId(targetNodeId);
        }
        return;
      }

      // Find the target node
      const targetNode = parser.findNodeById(targetNodeId);
      if (targetNode) {
        // Select the target node
        setSelectedNodeId(targetNodeId);

        // Clear previous highlight timeout
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
          highlightTimeoutRef.current = null;
        }

        // Scroll to the target node
        const scrollTimeout = setTimeout(() => {
          const element = document.querySelector(`[data-figma-id="${targetNodeId}"]`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            // Add a brief highlight effect
            element.classList.add("prototype-target-highlight");
            highlightTimeoutRef.current = setTimeout(() => {
              element.classList.remove("prototype-target-highlight");
            }, 1000);
          }
        }, 100);
        transitionTimeoutsRef.current.push(scrollTimeout);
      }
    },
    [parser, viewMode, overlayState]
  );

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      transitionTimeoutsRef.current.forEach(clearTimeout);
      transitionTimeoutsRef.current = [];
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  // AFTER_TIMEOUT trigger refs
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle AFTER_TIMEOUT triggers when entering a frame
  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Only active in prototype mode
    if (viewMode !== "prototype" || !currentPrototypeFrame) return;

    // Check for AFTER_TIMEOUT interactions on the current frame
    const interactions = (currentPrototypeFrame as any).prototypeInteractions;
    if (!interactions) return;

    const timeoutInteraction = interactions.find(
      (i: any) => i.event?.interactionType === "AFTER_TIMEOUT"
    );

    if (timeoutInteraction && timeoutInteraction.actions?.[0]) {
      const action = timeoutInteraction.actions[0];
      const delay = timeoutInteraction.event?.timeout || 1000; // Default 1 second

      if (action.transitionNodeID) {
        timeoutRef.current = setTimeout(() => {
          handlePrototypeNavigate(
            action.transitionNodeID,
            action.transitionType,
            action.transitionDuration,
            action.easingType,
            action.navigationType
          );
        }, delay);
      }
    }

    // Cleanup on unmount or frame change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [viewMode, currentPrototypeFrame, handlePrototypeNavigate]);

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
                  {(["render", "prototype", "tree", "text", "stats"] as ViewMode[]).map(
                    (mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          setViewMode(mode);
                          // Reset prototype frame when entering prototype mode
                          if (mode === "prototype") {
                            setPrototypeFrameId(undefined);
                          }
                        }}
                        style={{
                          ...tabStyle,
                          backgroundColor:
                            viewMode === mode ? "#4f46e5" : "transparent",
                          color: viewMode === mode ? "#fff" : "#6b7280",
                        }}
                      >
                        {mode === "prototype" ? "▶ Prototype" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    )
                  )}
                </div>

                {/* Page Selector */}
                {pages.length > 1 && (viewMode === "render" || viewMode === "prototype") && (
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
                {(viewMode === "render" || viewMode === "prototype") && (
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
                        <ErrorBoundary>
                          <FigmaRenderer
                            node={currentPage}
                            scale={scale}
                            selectedId={selectedNodeId}
                            onNodeClick={handleNodeClick}
                            onPrototypeNavigate={handlePrototypeNavigate}
                            showOutlines={showOutlines}
                          />
                        </ErrorBoundary>
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

              {viewMode === "prototype" && (
                <div style={prototypeContainerStyle}>
                  {/* Device Frame */}
                  <div style={deviceFrameStyle}>
                    <div style={deviceScreenStyle}>
                      {/* Frame name */}
                      <div style={prototypeFrameNameStyle}>
                        {currentPrototypeFrame?.name || "No frame selected"}
                      </div>
                      {/* Frame content */}
                      <div
                        className={
                          prototypeTransition?.isAnimating
                            ? `prototype-transition prototype-transition-${prototypeTransition.type.toLowerCase()}`
                            : undefined
                        }
                        style={{
                          ...prototypeCanvasStyle,
                          transform: `scale(${scale})`,
                          transformOrigin: "top left",
                          // Custom CSS properties for transition duration and easing
                          "--prototype-duration": prototypeTransition?.duration ? `${prototypeTransition.duration}ms` : "300ms",
                          "--prototype-easing": prototypeTransition?.easing || "ease-in-out",
                        } as React.CSSProperties}
                      >
                        {currentPrototypeFrame && (
                          <ErrorBoundary>
                            <FigmaRenderer
                              node={currentPrototypeFrame}
                              scale={1}
                              onNodeClick={handleNodeClick}
                              onPrototypeNavigate={handlePrototypeNavigate}
                              swapState={swapState}
                              findNodeById={findNodeByIdCallback}
                            />
                          </ErrorBoundary>
                        )}
                      </div>
                      {/* Overlay */}
                      {overlayState && overlayFrame && (
                        <div
                          className="prototype-overlay-backdrop"
                          style={overlayBackdropStyle}
                          onClick={handleCloseOverlay}
                        >
                          <div
                            className={`prototype-overlay prototype-transition-${(overlayState.transitionType || "dissolve").toLowerCase()}`}
                            style={{
                              ...overlayContentStyle,
                              transform: `scale(${scale})`,
                              transformOrigin: "center",
                              "--prototype-duration": overlayState.duration ? `${overlayState.duration}ms` : "300ms",
                              "--prototype-easing": overlayState.easing || "ease-in-out",
                            } as React.CSSProperties}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ErrorBoundary>
                              <FigmaRenderer
                                node={overlayFrame}
                                scale={1}
                                onNodeClick={handleNodeClick}
                                onPrototypeNavigate={handlePrototypeNavigate}
                                swapState={swapState}
                                findNodeById={findNodeByIdCallback}
                              />
                            </ErrorBoundary>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Device info */}
                    {prototypeInfo?.device && (
                      <div style={deviceInfoStyle}>
                        {prototypeInfo.device.presetIdentifier?.replace(/_/g, " ") || "Custom Device"}
                      </div>
                    )}
                  </div>
                  {/* Frame navigation */}
                  {prototypeInfo?.frames && prototypeInfo.frames.length > 1 && (
                    <div style={prototypeNavStyle}>
                      <span style={prototypeNavLabelStyle}>Frames:</span>
                      {prototypeInfo.frames.map((frame: FigmaNode) => (
                        <button
                          key={frame.id}
                          onClick={() => setPrototypeFrameId(frame.id)}
                          style={{
                            ...prototypeNavButtonStyle,
                            backgroundColor:
                              (prototypeFrameId || prototypeInfo.startFrameId) === frame.id
                                ? "#4f46e5"
                                : "#e5e7eb",
                            color:
                              (prototypeFrameId || prototypeInfo.startFrameId) === frame.id
                                ? "#fff"
                                : "#374151",
                          }}
                        >
                          {frame.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

// Prototype mode styles
const prototypeContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 32,
  backgroundColor: "#1f2937",
  gap: 24,
};

const deviceFrameStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  backgroundColor: "#111827",
  borderRadius: 40,
  padding: "40px 16px",
  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
  border: "4px solid #374151",
};

const deviceScreenStyle: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 8,
  overflow: "hidden",
  position: "relative",
  minWidth: 320,
  minHeight: 480,
  maxWidth: "90vw",
  maxHeight: "70vh",
};

const prototypeFrameNameStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  padding: "8px 12px",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 500,
  zIndex: 10,
};

const prototypeCanvasStyle: React.CSSProperties = {
  marginTop: 32,
  position: "relative",
};

const deviceInfoStyle: React.CSSProperties = {
  marginTop: 16,
  fontSize: 11,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const prototypeNavStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "center",
  maxWidth: "100%",
};

const prototypeNavLabelStyle: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: 12,
  fontWeight: 500,
};

const prototypeNavButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "none",
  fontSize: 12,
  cursor: "pointer",
  transition: "all 0.15s ease",
};

const overlayBackdropStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  animation: "fadeIn 0.2s ease-out",
};

const overlayContentStyle: React.CSSProperties = {
  position: "relative",
  backgroundColor: "#fff",
  borderRadius: 8,
  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
  overflow: "hidden",
};
