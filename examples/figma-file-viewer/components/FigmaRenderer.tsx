"use client";

import React, { CSSProperties, useCallback, useMemo } from "react";
import type {
  FigmaNode,
  FrameNode,
  TextNode,
  VectorNode,
  GroupNode,
  Paint,
  Effect,
  TypeStyle,
  CanvasNode,
  BooleanOperationNode,
  Rectangle,
} from "../lib/figma-types";
import {
  colorToRgba,
  paintToCSS,
  effectsToCSS,
} from "../lib/figma-parser";

/**
 * Convert Figma blend mode to CSS mix-blend-mode
 */
function blendModeToCSS(blendMode: string | undefined): string | undefined {
  if (!blendMode || blendMode === "PASS_THROUGH" || blendMode === "NORMAL") {
    return undefined;
  }
  const mapping: Record<string, string> = {
    "DARKEN": "darken",
    "MULTIPLY": "multiply",
    "LINEAR_BURN": "color-burn", // Approximate
    "COLOR_BURN": "color-burn",
    "LIGHTEN": "lighten",
    "SCREEN": "screen",
    "LINEAR_DODGE": "color-dodge", // Approximate
    "COLOR_DODGE": "color-dodge",
    "OVERLAY": "overlay",
    "SOFT_LIGHT": "soft-light",
    "HARD_LIGHT": "hard-light",
    "DIFFERENCE": "difference",
    "EXCLUSION": "exclusion",
    "HUE": "hue",
    "SATURATION": "saturation",
    "COLOR": "color",
    "LUMINOSITY": "luminosity",
  };
  return mapping[blendMode];
}

/**
 * Apply blend mode to style object
 */
function applyBlendMode(s: CSSProperties, node: { blendMode?: string }): void {
  const blendMode = blendModeToCSS(node.blendMode);
  if (blendMode) {
    s.mixBlendMode = blendMode as any;
  }
}

/**
 * Apply transform matrix from Figma's relativeTransform
 * relativeTransform is a 2x3 matrix: [[m00, m01, m02], [m10, m11, m12]]
 * CSS matrix() is: matrix(m00, m10, m01, m11, m02, m12)
 */
function applyTransform(s: CSSProperties, node: { relativeTransform?: number[][] }, scale: number): void {
  if (!node.relativeTransform) return;
  const [[m00, m01, m02], [m10, m11, m12]] = node.relativeTransform;
  // Apply CSS matrix transform (note the different parameter order)
  // We only apply rotation/scale/skew, not translation (handled by position)
  if (m00 !== 1 || m11 !== 1 || m01 !== 0 || m10 !== 0) {
    s.transform = `matrix(${m00}, ${m10}, ${m01}, ${m11}, 0, 0)`;
    s.transformOrigin = "top left";
  }
}

/**
 * Apply stroke properties including dashed strokes
 */
function applyStroke(
  s: CSSProperties,
  node: {
    strokes?: Paint[];
    strokeWeight?: number;
    strokeAlign?: string;
    strokeCap?: string;
    strokeJoin?: string;
    dashPattern?: number[];
  },
  scale: number
): void {
  if (!node.strokes || node.strokes.length === 0 || !node.strokeWeight) return;

  const strokeColor = paintToCSS(node.strokes[0]);
  if (!strokeColor) return;

  const weight = node.strokeWeight * scale;

  // Handle stroke alignment (INSIDE, CENTER, OUTSIDE)
  // CSS borders are always inside for box-sizing: border-box
  // For OUTSIDE strokes, we use outline instead
  // For CENTER strokes (default), use border
  if (node.strokeAlign === "OUTSIDE") {
    s.outline = `${weight}px solid ${strokeColor}`;
    s.outlineOffset = "0px";
  } else {
    s.border = `${weight}px solid ${strokeColor}`;
    // For INSIDE alignment, we need to account for border in the size
    if (node.strokeAlign === "INSIDE") {
      s.boxSizing = "border-box";
    }
  }

  // Handle dashed strokes (only works well with border, not outline)
  if (node.dashPattern && node.dashPattern.length > 0 && node.strokeAlign !== "OUTSIDE") {
    const dashArray = node.dashPattern.map(d => `${d * scale}px`).join(" ");
    s.borderStyle = "dashed";
    // Note: CSS doesn't support custom dash patterns directly
    // borderStyle: dashed uses browser default
  }
}

interface FigmaRendererProps {
  node: FigmaNode;
  scale?: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  renderMode?: "absolute" | "flow";
  showOutlines?: boolean;
}

/**
 * Main Figma Renderer Component
 * Renders Figma nodes as equivalent React components
 */
export function FigmaRenderer({
  node,
  scale = 1,
  selectedId,
  onNodeClick,
  renderMode = "absolute",
  showOutlines = false,
}: FigmaRendererProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onNodeClick?.(node);
    },
    [node, onNodeClick]
  );

  // Skip invisible nodes
  if (node.visible === false) {
    return null;
  }

  const isSelected = selectedId === node.id;

  // Common wrapper styles
  const getWrapperStyle = (): CSSProperties => {
    const style: CSSProperties = {};

    if (showOutlines) {
      style.outline = isSelected ? "2px solid #0066ff" : "1px dashed rgba(0,0,0,0.1)";
    } else if (isSelected) {
      style.outline = "2px solid #0066ff";
    }

    return style;
  };

  switch (node.type) {
    case "DOCUMENT":
      return (
        <div className="figma-document" style={getWrapperStyle()}>
          {"children" in node &&
            node.children?.map((child, index) => (
              <FigmaRenderer
                key={child.id || index}
                node={child as FigmaNode}
                scale={scale}
                selectedId={selectedId}
                onNodeClick={onNodeClick}
                renderMode={renderMode}
                showOutlines={showOutlines}
              />
            ))}
        </div>
      );

    case "CANVAS":
      return (
        <CanvasRenderer
          node={node as CanvasNode}
          scale={scale}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          onClick={handleClick}
          wrapperStyle={getWrapperStyle()}
          renderMode={renderMode}
          showOutlines={showOutlines}
        />
      );

    case "FRAME":
    case "COMPONENT":
    case "COMPONENT_SET":
    case "INSTANCE":
    case "SYMBOL":
    case "SECTION":
    case "SLIDE":
    case "SLIDE_ROW":
    case "SLIDE_GRID":
    case "TRANSFORM_GROUP":
    case "WIDGET":
    case "EMBED":
    case "MEDIA":
    case "LINK_UNFURL":
      return (
        <FrameRenderer
          node={node as FrameNode}
          scale={scale}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          onClick={handleClick}
          wrapperStyle={getWrapperStyle()}
          renderMode={renderMode}
          showOutlines={showOutlines}
        />
      );

    case "GROUP":
    case "STICKY":
    case "SHAPE_WITH_TEXT":
    case "CONNECTOR":
    case "CODE_BLOCK":
      return (
        <GroupRenderer
          node={node as GroupNode}
          scale={scale}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          onClick={handleClick}
          wrapperStyle={getWrapperStyle()}
          renderMode={renderMode}
          showOutlines={showOutlines}
        />
      );

    case "TEXT":
      return (
        <TextRenderer
          node={node as TextNode}
          scale={scale}
          onClick={handleClick}
          wrapperStyle={getWrapperStyle()}
          renderMode={renderMode}
        />
      );

    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
    case "ELLIPSE":
    case "LINE":
    case "VECTOR":
    case "STAR":
    case "REGULAR_POLYGON":
    case "POLYGON":
    case "TEXT_PATH":
    case "SLICE":
    case "STAMP":
    case "HIGHLIGHT":
    case "WASHI_TAPE":
    case "INTERACTIVE_SLIDE_ELEMENT":
      return (
        <VectorRenderer
          node={node as VectorNode}
          scale={scale}
          onClick={handleClick}
          wrapperStyle={getWrapperStyle()}
          renderMode={renderMode}
        />
      );

    case "BOOLEAN_OPERATION":
      return (
        <BooleanRenderer
          node={node as BooleanOperationNode}
          scale={scale}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          onClick={handleClick}
          wrapperStyle={getWrapperStyle()}
          renderMode={renderMode}
          showOutlines={showOutlines}
        />
      );

    default:
      // Render a placeholder for unsupported node types
      return (
        <div
          className="figma-unsupported"
          onClick={handleClick}
          style={{
            ...getWrapperStyle(),
            padding: "8px",
            background: "#f0f0f0",
            border: "1px dashed #ccc",
            fontSize: "12px",
            color: "#666",
          }}
        >
          {node.type}: {node.name}
        </div>
      );
  }
}

/**
 * Canvas (Page) Renderer
 */
function CanvasRenderer({
  node,
  scale,
  selectedId,
  onNodeClick,
  onClick,
  wrapperStyle,
  renderMode,
  showOutlines,
}: {
  node: CanvasNode;
  scale: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  showOutlines: boolean;
}) {
  const bgColor = node.backgroundColor
    ? colorToRgba(node.backgroundColor)
    : "#ffffff";

  // Calculate bounds for the canvas
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    node.children?.forEach((child) => {
      const childNode = child as FigmaNode;
      if ("absoluteBoundingBox" in childNode && childNode.absoluteBoundingBox) {
        const box = childNode.absoluteBoundingBox;
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      }
    });

    if (minX === Infinity) {
      return { x: 0, y: 0, width: 800, height: 600 };
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [node.children]);

  return (
    <div
      className="figma-canvas"
      onClick={onClick}
      style={{
        ...wrapperStyle,
        position: "relative",
        backgroundColor: bgColor,
        width: bounds.width * scale,
        height: bounds.height * scale,
        overflow: "hidden",
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    >
      {node.children?.map((child, index) => (
        <FigmaRenderer
          key={(child as FigmaNode).id || index}
          node={child as FigmaNode}
          scale={1}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          renderMode={renderMode}
          showOutlines={showOutlines}
        />
      ))}
    </div>
  );
}

/**
 * Frame Renderer
 */
function FrameRenderer({
  node,
  scale,
  selectedId,
  onNodeClick,
  onClick,
  wrapperStyle,
  renderMode,
  showOutlines,
}: {
  node: FrameNode;
  scale: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  showOutlines: boolean;
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
      boxSizing: "border-box",
    };

    // Position and size
    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      s.left = node.absoluteBoundingBox.x * scale;
      s.top = node.absoluteBoundingBox.y * scale;
      s.width = node.absoluteBoundingBox.width * scale;
      s.height = node.absoluteBoundingBox.height * scale;
    } else if (node.size) {
      s.width = node.size.x * scale;
      s.height = node.size.y * scale;
    }

    // Layout mode (flexbox)
    if (node.layoutMode && node.layoutMode !== "NONE") {
      s.display = "flex";
      s.flexDirection = node.layoutMode === "HORIZONTAL" ? "row" : "column";

      // Wrap
      if (node.layoutWrap === "WRAP") {
        s.flexWrap = "wrap";
      }

      // Primary axis alignment
      switch (node.primaryAxisAlignItems) {
        case "MIN": s.justifyContent = "flex-start"; break;
        case "CENTER": s.justifyContent = "center"; break;
        case "MAX": s.justifyContent = "flex-end"; break;
        case "SPACE_BETWEEN": s.justifyContent = "space-between"; break;
      }

      // Counter axis alignment
      switch (node.counterAxisAlignItems) {
        case "MIN": s.alignItems = "flex-start"; break;
        case "CENTER": s.alignItems = "center"; break;
        case "MAX": s.alignItems = "flex-end"; break;
        case "BASELINE": s.alignItems = "baseline"; break;
      }

      // Padding
      if (node.paddingTop) s.paddingTop = node.paddingTop * scale;
      if (node.paddingRight) s.paddingRight = node.paddingRight * scale;
      if (node.paddingBottom) s.paddingBottom = node.paddingBottom * scale;
      if (node.paddingLeft) s.paddingLeft = node.paddingLeft * scale;

      // Gap
      if (node.itemSpacing) s.gap = node.itemSpacing * scale;
    }

    // Background
    if (node.fills && node.fills.length > 0) {
      const backgrounds: string[] = [];
      for (const fill of node.fills) {
        const bg = paintToCSS(fill);
        if (bg) backgrounds.push(bg);
      }
      if (backgrounds.length > 0) {
        // Use 'background' for images and gradients, 'backgroundColor' for solid colors
        const hasImageOrGradient = backgrounds.some(bg => bg.includes("url(") || bg.includes("gradient"));
        if (backgrounds.length === 1 && !hasImageOrGradient) {
          s.backgroundColor = backgrounds[0];
        } else {
          s.background = backgrounds.reverse().join(", ");
        }
      }
    }

    // Border radius
    if (node.cornerRadius) {
      s.borderRadius = node.cornerRadius * scale;
    } else if (node.rectangleCornerRadii) {
      s.borderRadius = node.rectangleCornerRadii
        .map((r) => `${r * scale}px`)
        .join(" ");
    }

    // Stroke (border) with full properties
    applyStroke(s, node, scale);

    // Effects (shadows, blur)
    if (node.effects && node.effects.length > 0) {
      const effects = effectsToCSS(node.effects);
      if (effects.boxShadow) s.boxShadow = effects.boxShadow;
      if (effects.filter) s.filter = effects.filter;
      if (effects.backdropFilter) s.backdropFilter = effects.backdropFilter;
    }

    // Opacity
    if (node.opacity !== undefined && node.opacity < 1) {
      s.opacity = node.opacity;
    }

    // Clip content
    if (node.clipsContent) {
      s.overflow = "hidden";
    }

    // Transform (rotation/skew)
    applyTransform(s, node, scale);

    // Blend mode
    applyBlendMode(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode]);

  return (
    <div
      className={`figma-frame figma-${node.type.toLowerCase()}`}
      onClick={onClick}
      style={style}
      data-figma-id={node.id}
      data-figma-name={node.name}
    >
      {node.children?.map((child, index) => (
        <FigmaRenderer
          key={(child as FigmaNode).id || index}
          node={child as FigmaNode}
          scale={1}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          renderMode={node.layoutMode && node.layoutMode !== "NONE" ? "flow" : renderMode}
          showOutlines={showOutlines}
        />
      ))}
    </div>
  );
}

/**
 * Group Renderer
 */
function GroupRenderer({
  node,
  scale,
  selectedId,
  onNodeClick,
  onClick,
  wrapperStyle,
  renderMode,
  showOutlines,
}: {
  node: GroupNode;
  scale: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  showOutlines: boolean;
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      s.left = node.absoluteBoundingBox.x * scale;
      s.top = node.absoluteBoundingBox.y * scale;
      s.width = node.absoluteBoundingBox.width * scale;
      s.height = node.absoluteBoundingBox.height * scale;
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      s.opacity = node.opacity;
    }

    if (node.effects && node.effects.length > 0) {
      const effects = effectsToCSS(node.effects);
      if (effects.boxShadow) s.boxShadow = effects.boxShadow;
      if (effects.filter) s.filter = effects.filter;
      if (effects.backdropFilter) s.backdropFilter = effects.backdropFilter;
    }

    // Transform (rotation/skew)
    applyTransform(s, node, scale);

    // Blend mode
    applyBlendMode(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode]);

  return (
    <div
      className="figma-group"
      onClick={onClick}
      style={style}
      data-figma-id={node.id}
      data-figma-name={node.name}
    >
      {node.children?.map((child, index) => (
        <FigmaRenderer
          key={(child as FigmaNode).id || index}
          node={child as FigmaNode}
          scale={1}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          renderMode={renderMode}
          showOutlines={showOutlines}
        />
      ))}
    </div>
  );
}

/**
 * Text Renderer
 */
function TextRenderer({
  node,
  scale,
  onClick,
  wrapperStyle,
  renderMode,
}: {
  node: TextNode;
  scale: number;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      s.left = node.absoluteBoundingBox.x * scale;
      s.top = node.absoluteBoundingBox.y * scale;
      s.width = node.absoluteBoundingBox.width * scale;
    }

    // Text styles
    if (node.style) {
      const ts = node.style;

      s.fontFamily = `"${ts.fontFamily}", system-ui, sans-serif`;
      s.fontSize = ts.fontSize * scale;
      s.fontWeight = ts.fontWeight;

      // Font style (italic/oblique)
      if (ts.fontStyle === "italic" || ts.italic) {
        s.fontStyle = "italic";
      }

      // Letter spacing - handle both pixel and percent units
      if (ts.letterSpacing) {
        if (ts.letterSpacingUnit === "PERCENT") {
          s.letterSpacing = `${ts.letterSpacing / 100}em`;
        } else {
          s.letterSpacing = ts.letterSpacing * scale;
        }
      }

      if (ts.lineHeightPx) {
        s.lineHeight = `${ts.lineHeightPx * scale}px`;
      } else if (ts.lineHeightPercent) {
        s.lineHeight = `${ts.lineHeightPercent}%`;
      }

      // Text alignment
      switch (ts.textAlignHorizontal) {
        case "LEFT": s.textAlign = "left"; break;
        case "CENTER": s.textAlign = "center"; break;
        case "RIGHT": s.textAlign = "right"; break;
        case "JUSTIFIED": s.textAlign = "justify"; break;
      }

      // Text decoration
      switch (ts.textDecoration) {
        case "UNDERLINE": s.textDecoration = "underline"; break;
        case "STRIKETHROUGH": s.textDecoration = "line-through"; break;
      }

      // Text case
      switch (ts.textCase) {
        case "UPPER": s.textTransform = "uppercase"; break;
        case "LOWER": s.textTransform = "lowercase"; break;
        case "TITLE": s.textTransform = "capitalize"; break;
      }

      // Fill color for text
      if (ts.fills && ts.fills.length > 0) {
        const fill = paintToCSS(ts.fills[0]);
        if (fill) s.color = fill;
      }
    }

    // Fallback to node fills
    if (!s.color && node.fills && node.fills.length > 0) {
      const fill = paintToCSS(node.fills[0]);
      if (fill) s.color = fill;
    }

    // Opacity
    if (node.opacity !== undefined && node.opacity < 1) {
      s.opacity = node.opacity;
    }

    // Effects
    if (node.effects && node.effects.length > 0) {
      const effects = effectsToCSS(node.effects);
      // Text uses text-shadow for drop shadows (more appropriate than box-shadow)
      if (effects.boxShadow) {
        // Convert box-shadow format to text-shadow (no spread value)
        s.textShadow = effects.boxShadow.replace(/(\d+px)\s*(\d+px)\s*(\d+px)\s*\d+px/g, "$1 $2 $3");
      }
      if (effects.filter) s.filter = effects.filter;
    }

    // Transform (rotation/skew)
    applyTransform(s, node, scale);

    // Blend mode
    applyBlendMode(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode]);

  return (
    <span
      className="figma-text"
      onClick={onClick}
      style={style}
      data-figma-id={node.id}
      data-figma-name={node.name}
    >
      {node.characters}
    </span>
  );
}

/**
 * Vector/Shape Renderer
 */
function VectorRenderer({
  node,
  scale,
  onClick,
  wrapperStyle,
  renderMode,
}: {
  node: VectorNode;
  scale: number;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
      boxSizing: "border-box",
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      s.left = node.absoluteBoundingBox.x * scale;
      s.top = node.absoluteBoundingBox.y * scale;
      s.width = node.absoluteBoundingBox.width * scale;
      s.height = node.absoluteBoundingBox.height * scale;
    } else if (node.size) {
      s.width = node.size.x * scale;
      s.height = node.size.y * scale;
    }

    // Background fills
    if (node.fills && node.fills.length > 0) {
      const backgrounds: string[] = [];
      for (const fill of node.fills) {
        const bg = paintToCSS(fill);
        if (bg) backgrounds.push(bg);
      }
      if (backgrounds.length > 0) {
        // Use 'background' for images and gradients, 'backgroundColor' for solid colors
        const hasImageOrGradient = backgrounds.some(bg => bg.includes("url(") || bg.includes("gradient"));
        if (backgrounds.length === 1 && !hasImageOrGradient) {
          s.backgroundColor = backgrounds[0];
        } else {
          s.background = backgrounds.reverse().join(", ");
        }
      }
    }

    // Shape-specific styling
    if (node.type === "ELLIPSE") {
      s.borderRadius = "50%";
    } else if (node.type === "LINE") {
      // For lines, use a border instead of background
      if (node.strokes && node.strokes.length > 0) {
        const strokeColor = paintToCSS(node.strokes[0]);
        if (strokeColor) {
          s.backgroundColor = "transparent";
          s.borderTop = `${(node.strokeWeight || 1) * scale}px solid ${strokeColor}`;
        }
      }
    }

    // Border radius for rectangles
    if (node.type === "RECTANGLE" || node.type === "ROUNDED_RECTANGLE") {
      if (node.cornerRadius) {
        s.borderRadius = node.cornerRadius * scale;
      } else if (node.rectangleCornerRadii) {
        s.borderRadius = node.rectangleCornerRadii
          .map((r) => `${r * scale}px`)
          .join(" ");
      }
    }

    // Stroke with full properties
    if (node.type !== "LINE") {
      applyStroke(s, node, scale);
    }

    // Transform (rotation/skew)
    applyTransform(s, node, scale);

    // Effects
    if (node.effects && node.effects.length > 0) {
      const effects = effectsToCSS(node.effects);
      if (effects.boxShadow) s.boxShadow = effects.boxShadow;
      if (effects.filter) s.filter = effects.filter;
    }

    // Opacity
    if (node.opacity !== undefined && node.opacity < 1) {
      s.opacity = node.opacity;
    }

    // Blend mode
    applyBlendMode(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode]);

  // For complex vector paths, render as SVG
  if (node.fillGeometry && node.fillGeometry.length > 0 && node.type === "VECTOR") {
    return (
      <SVGVectorRenderer
        node={node}
        scale={scale}
        onClick={onClick}
        wrapperStyle={wrapperStyle}
        renderMode={renderMode}
      />
    );
  }

  return (
    <div
      className={`figma-vector figma-${node.type.toLowerCase()}`}
      onClick={onClick}
      style={style}
      data-figma-id={node.id}
      data-figma-name={node.name}
    />
  );
}

/**
 * SVG Vector Renderer for complex paths
 */
function SVGVectorRenderer({
  node,
  scale,
  onClick,
  wrapperStyle,
  renderMode,
}: {
  node: VectorNode;
  scale: number;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
}) {
  const containerStyle = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      s.left = node.absoluteBoundingBox.x * scale;
      s.top = node.absoluteBoundingBox.y * scale;
      s.width = node.absoluteBoundingBox.width * scale;
      s.height = node.absoluteBoundingBox.height * scale;
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      s.opacity = node.opacity;
    }

    // Effects
    if (node.effects && node.effects.length > 0) {
      const effects = effectsToCSS(node.effects);
      if (effects.filter) s.filter = effects.filter;
    }

    // Blend mode
    applyBlendMode(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode]);

  const fillColor = useMemo(() => {
    if (node.fills && node.fills.length > 0) {
      return paintToCSS(node.fills[0]) || "none";
    }
    return "none";
  }, [node.fills]);

  const strokeColor = useMemo(() => {
    if (node.strokes && node.strokes.length > 0) {
      return paintToCSS(node.strokes[0]) || "none";
    }
    return "none";
  }, [node.strokes]);

  const width = node.absoluteBoundingBox?.width || node.size?.x || 100;
  const height = node.absoluteBoundingBox?.height || node.size?.y || 100;

  return (
    <div
      className="figma-svg-vector"
      onClick={onClick}
      style={containerStyle}
      data-figma-id={node.id}
      data-figma-name={node.name}
    >
      <svg
        width={width * scale}
        height={height * scale}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block" }}
      >
        {/* Render fill paths from vectorPaths */}
        {node.vectorPaths?.map((vp, index) => (
          <path
            key={`fill-${index}`}
            d={vp.path}
            fill={fillColor}
            stroke="none"
            fillRule={vp.windingRule === "EVENODD" || vp.windingRule === "ODD" ? "evenodd" : "nonzero"}
          />
        ))}
        {/* Render stroke paths from strokePaths or fallback to vectorPaths with stroke */}
        {node.strokePaths?.map((sp, index) => (
          <path
            key={`stroke-${index}`}
            d={sp.path}
            fill="none"
            stroke={strokeColor}
            strokeWidth={node.strokeWeight || 1}
            strokeLinecap={node.strokeCap === "ROUND" ? "round" : node.strokeCap === "SQUARE" ? "square" : "butt"}
            strokeLinejoin={node.strokeJoin === "ROUND" ? "round" : node.strokeJoin === "BEVEL" ? "bevel" : "miter"}
            fillRule={sp.windingRule === "EVENODD" || sp.windingRule === "ODD" ? "evenodd" : "nonzero"}
          />
        ))}
        {/* If no strokePaths but there are strokes, add stroke to vectorPaths */}
        {!node.strokePaths && node.strokes && node.strokes.length > 0 && node.vectorPaths?.map((vp, index) => (
          <path
            key={`path-stroke-${index}`}
            d={vp.path}
            fill="none"
            stroke={strokeColor}
            strokeWidth={node.strokeWeight || 1}
            strokeLinecap={node.strokeCap === "ROUND" ? "round" : node.strokeCap === "SQUARE" ? "square" : "butt"}
            strokeLinejoin={node.strokeJoin === "ROUND" ? "round" : node.strokeJoin === "BEVEL" ? "bevel" : "miter"}
          />
        ))}
        {/* Fallback to fillGeometry if no vectorPaths */}
        {!node.vectorPaths && node.fillGeometry?.map((path, index) => (
          <path
            key={`legacy-${index}`}
            d={path.data}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={node.strokeWeight || 0}
            fillRule={path.windingRule === "EVENODD" ? "evenodd" : "nonzero"}
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * Boolean Operation Renderer
 */
function BooleanRenderer({
  node,
  scale,
  selectedId,
  onNodeClick,
  onClick,
  wrapperStyle,
  renderMode,
  showOutlines,
}: {
  node: BooleanOperationNode;
  scale: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  showOutlines: boolean;
}) {
  // Boolean operations are complex - we'll render the result as an SVG if possible
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      s.left = node.absoluteBoundingBox.x * scale;
      s.top = node.absoluteBoundingBox.y * scale;
      s.width = node.absoluteBoundingBox.width * scale;
      s.height = node.absoluteBoundingBox.height * scale;
    }

    // Background
    if (node.fills && node.fills.length > 0) {
      const backgrounds: string[] = [];
      for (const fill of node.fills) {
        const bg = paintToCSS(fill);
        if (bg) backgrounds.push(bg);
      }
      if (backgrounds.length > 0) {
        // Use 'background' for images, 'backgroundColor' for solid colors
        if (backgrounds[0].includes("url(")) {
          s.background = backgrounds[0];
        } else {
          s.backgroundColor = backgrounds[0];
        }
      }
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      s.opacity = node.opacity;
    }

    // Effects
    if (node.effects && node.effects.length > 0) {
      const effects = effectsToCSS(node.effects);
      if (effects.boxShadow) s.boxShadow = effects.boxShadow;
      if (effects.filter) s.filter = effects.filter;
      if (effects.backdropFilter) s.backdropFilter = effects.backdropFilter;
    }

    // Blend mode
    applyBlendMode(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode]);

  // If we have fill geometry, render as SVG
  if (node.fillGeometry && node.fillGeometry.length > 0) {
    const width = node.absoluteBoundingBox?.width || 100;
    const height = node.absoluteBoundingBox?.height || 100;

    const fillColor = node.fills && node.fills.length > 0
      ? paintToCSS(node.fills[0]) || "none"
      : "none";

    const strokeColor = node.strokes && node.strokes.length > 0
      ? paintToCSS(node.strokes[0]) || "none"
      : "none";

    return (
      <div
        className="figma-boolean"
        onClick={onClick}
        style={style}
        data-figma-id={node.id}
        data-figma-name={node.name}
      >
        <svg
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block" }}
        >
          {node.fillGeometry.map((path, index) => (
            <path
              key={index}
              d={path.data}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={node.strokeWeight || 0}
              fillRule={path.windingRule === "EVENODD" ? "evenodd" : "nonzero"}
            />
          ))}
        </svg>
      </div>
    );
  }

  // Fallback to rendering children
  return (
    <div
      className="figma-boolean"
      onClick={onClick}
      style={style}
      data-figma-id={node.id}
      data-figma-name={node.name}
    >
      {node.children?.map((child, index) => (
        <FigmaRenderer
          key={(child as FigmaNode).id || index}
          node={child as FigmaNode}
          scale={1}
          selectedId={selectedId}
          onNodeClick={onNodeClick}
          renderMode={renderMode}
          showOutlines={showOutlines}
        />
      ))}
    </div>
  );
}

export default FigmaRenderer;
