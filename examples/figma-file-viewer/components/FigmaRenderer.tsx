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
    // Create stacking context for proper blend mode isolation
    s.isolation = "isolate";
  }
}

/**
 * Apply isolation for proper opacity compositing on groups
 */
function applyIsolation(s: CSSProperties, node: { opacity?: number; blendMode?: string }): void {
  // Group opacity requires isolation so children composite before opacity is applied
  if ((node.opacity !== undefined && node.opacity < 1) ||
      (node.blendMode && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL")) {
    s.isolation = "isolate";
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
  parentBounds?: Rectangle; // Parent's bounding box for relative positioning
}

/**
 * Main Figma Renderer Component
 * Renders Figma nodes as equivalent React components
 */
/**
 * Generate SVG path for a regular polygon
 */
function generatePolygonPath(width: number, height: number, sides: number = 6): string {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;
  const angleOffset = -Math.PI / 2; // Start from top

  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = angleOffset + (2 * Math.PI * i) / sides;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    points.push(`${x.toFixed(3)},${y.toFixed(3)}`);
  }

  return `M ${points.join(" L ")} Z`;
}

/**
 * Generate SVG path for a squircle (superellipse rounded rectangle)
 * iOS-style continuous corner curvature
 */
function generateSquirclePath(
  width: number,
  height: number,
  radius: number,
  smoothing: number = 0.6
): string {
  // Clamp radius to half of smallest dimension
  const maxRadius = Math.min(width, height) / 2;
  const r = Math.min(radius, maxRadius);

  if (r <= 0 || smoothing <= 0) {
    return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
  }

  // For squircle, extend curve further along edges
  // The smoothing factor controls how much (1.0 to 1.8x radius)
  const p = 1 + smoothing * 0.8;
  const arcLength = Math.min(r * p, width / 2, height / 2);

  // Modified kappa for rounder iOS-style curves
  const k = 0.5522847498 * (1 + smoothing * 0.3);
  const cp = r * k;

  // Build path clockwise from top-left
  return [
    `M ${arcLength} 0`,
    `L ${width - arcLength} 0`,
    `C ${width - arcLength + cp} 0, ${width} ${arcLength - cp}, ${width} ${arcLength}`,
    `L ${width} ${height - arcLength}`,
    `C ${width} ${height - arcLength + cp}, ${width - arcLength + cp} ${height}, ${width - arcLength} ${height}`,
    `L ${arcLength} ${height}`,
    `C ${arcLength - cp} ${height}, 0 ${height - arcLength + cp}, 0 ${height - arcLength}`,
    `L 0 ${arcLength}`,
    `C 0 ${arcLength - cp}, ${arcLength - cp} 0, ${arcLength} 0`,
    `Z`
  ].join(" ");
}

/**
 * Generate SVG path for a star
 */
function generateStarPath(
  width: number,
  height: number,
  points: number = 5,
  innerRadiusRatio: number = 0.382
): string {
  const cx = width / 2;
  const cy = height / 2;
  const outerRadius = Math.min(width, height) / 2;
  const innerRadius = outerRadius * innerRadiusRatio;
  const angleOffset = -Math.PI / 2; // Start from top

  const pathPoints: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = angleOffset + (Math.PI * i) / points;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    pathPoints.push(`${x.toFixed(3)},${y.toFixed(3)}`);
  }

  return `M ${pathPoints.join(" L ")} Z`;
}

/**
 * Get position relative to parent bounds
 */
function getRelativePosition(
  absoluteBounds: Rectangle | undefined,
  parentBounds: Rectangle | undefined,
  scale: number
): { left: number; top: number } | null {
  if (!absoluteBounds) return null;

  const parentX = parentBounds?.x ?? 0;
  const parentY = parentBounds?.y ?? 0;

  return {
    left: (absoluteBounds.x - parentX) * scale,
    top: (absoluteBounds.y - parentY) * scale,
  };
}

export function FigmaRenderer({
  node,
  scale = 1,
  selectedId,
  onNodeClick,
  renderMode = "absolute",
  showOutlines = false,
  parentBounds,
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
          parentBounds={parentBounds}
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
          parentBounds={parentBounds}
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
          parentBounds={parentBounds}
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
          parentBounds={parentBounds}
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
          parentBounds={parentBounds}
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
          parentBounds={{ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }}
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
  parentBounds,
}: {
  node: FrameNode;
  scale: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  showOutlines: boolean;
  parentBounds?: Rectangle;
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
      boxSizing: "border-box",
    };

    // Position and size - use relative positioning when we have parent bounds
    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      const relPos = getRelativePosition(node.absoluteBoundingBox, parentBounds, scale);
      if (relPos) {
        s.left = relPos.left;
        s.top = relPos.top;
      }
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

    // Isolation for proper group compositing
    applyIsolation(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode, parentBounds]);

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
          parentBounds={node.absoluteBoundingBox}
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
  parentBounds,
}: {
  node: GroupNode;
  scale: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  showOutlines: boolean;
  parentBounds?: Rectangle;
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      const relPos = getRelativePosition(node.absoluteBoundingBox, parentBounds, scale);
      if (relPos) {
        s.left = relPos.left;
        s.top = relPos.top;
      }
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

    // Isolation for proper group compositing
    applyIsolation(s, node);

    return s;
  }, [node, scale, wrapperStyle, renderMode, parentBounds]);

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
          parentBounds={node.absoluteBoundingBox}
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
  parentBounds,
}: {
  node: TextNode;
  scale: number;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  parentBounds?: Rectangle;
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      const relPos = getRelativePosition(node.absoluteBoundingBox, parentBounds, scale);
      if (relPos) {
        s.left = relPos.left;
        s.top = relPos.top;
      }
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

      // Vertical text alignment using flexbox
      if (ts.textAlignVertical && ts.textAlignVertical !== "TOP") {
        s.display = "flex";
        s.flexDirection = "column";
        switch (ts.textAlignVertical) {
          case "CENTER": s.justifyContent = "center"; break;
          case "BOTTOM": s.justifyContent = "flex-end"; break;
        }
        // If we also have height set, use the full height
        if (node.absoluteBoundingBox && renderMode === "absolute") {
          s.height = node.absoluteBoundingBox.height * scale;
        }
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
        case "SMALL_CAPS":
        case "SMALL_CAPS_FORCED":
          s.fontVariant = "small-caps";
          break;
      }

      // Text truncation with maxLines support
      if (ts.textTruncation === "ENDING" || node.textTruncation === "ENDING") {
        const maxLines = ts.maxLines || node.maxLines;
        if (maxLines && maxLines > 1) {
          // Multi-line truncation using CSS line-clamp
          s.display = "-webkit-box";
          (s as any).WebkitLineClamp = maxLines;
          (s as any).WebkitBoxOrient = "vertical";
          s.overflow = "hidden";
        } else {
          // Single line truncation
          s.overflow = "hidden";
          s.textOverflow = "ellipsis";
          s.whiteSpace = "nowrap";
        }
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
  }, [node, scale, wrapperStyle, renderMode, parentBounds]);

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
  parentBounds,
}: {
  node: VectorNode;
  scale: number;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  parentBounds?: Rectangle;
}) {
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
      boxSizing: "border-box",
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      const relPos = getRelativePosition(node.absoluteBoundingBox, parentBounds, scale);
      if (relPos) {
        s.left = relPos.left;
        s.top = relPos.top;
      }
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
  }, [node, scale, wrapperStyle, renderMode, parentBounds]);

  // For complex vector paths, render as SVG
  if (node.fillGeometry && node.fillGeometry.length > 0 && node.type === "VECTOR") {
    return (
      <SVGVectorRenderer
        node={node}
        scale={scale}
        onClick={onClick}
        wrapperStyle={wrapperStyle}
        renderMode={renderMode}
        parentBounds={parentBounds}
      />
    );
  }

  // Render rectangles with cornerSmoothing as SVG squircle
  if ((node.type === "RECTANGLE" || node.type === "ROUNDED_RECTANGLE") && node.cornerSmoothing && node.cornerSmoothing > 0) {
    const width = node.absoluteBoundingBox?.width || node.size?.x || 100;
    const height = node.absoluteBoundingBox?.height || node.size?.y || 100;
    const radius = node.cornerRadius || 0;

    const svgPath = generateSquirclePath(width, height, radius, node.cornerSmoothing);

    const fillColor = node.fills && node.fills.length > 0
      ? paintToCSS(node.fills[0]) || "none"
      : "none";
    const strokeColor = node.strokes && node.strokes.length > 0
      ? paintToCSS(node.strokes[0]) || "none"
      : "none";

    return (
      <div
        className={`figma-vector figma-squircle`}
        onClick={onClick}
        style={{
          ...style,
          backgroundColor: "transparent",
          background: "none",
          borderRadius: 0,
        }}
        data-figma-id={node.id}
        data-figma-name={node.name}
      >
        <svg
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block" }}
        >
          <path
            d={svgPath}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={node.strokeWeight || 0}
          />
        </svg>
      </div>
    );
  }

  // Render stars and polygons as SVG
  if (node.type === "STAR" || node.type === "REGULAR_POLYGON" || node.type === "POLYGON") {
    const width = node.absoluteBoundingBox?.width || node.size?.x || 100;
    const height = node.absoluteBoundingBox?.height || node.size?.y || 100;

    // Generate the path based on shape type
    let svgPath: string;
    if (node.type === "STAR") {
      // Use starInnerScale if available, default to golden ratio
      const innerRatio = (node as unknown as { starInnerScale?: number }).starInnerScale ?? 0.382;
      const pointCount = (node as unknown as { pointCount?: number }).pointCount ?? 5;
      svgPath = generateStarPath(width, height, pointCount, innerRatio);
    } else {
      // Regular polygon
      const sides = (node as unknown as { pointCount?: number }).pointCount ?? 6;
      svgPath = generatePolygonPath(width, height, sides);
    }

    const fillColor = node.fills && node.fills.length > 0
      ? paintToCSS(node.fills[0]) || "none"
      : "none";
    const strokeColor = node.strokes && node.strokes.length > 0
      ? paintToCSS(node.strokes[0]) || "none"
      : "none";

    return (
      <div
        className={`figma-vector figma-${node.type.toLowerCase()}`}
        onClick={onClick}
        style={{
          ...style,
          backgroundColor: "transparent",
          background: "none",
        }}
        data-figma-id={node.id}
        data-figma-name={node.name}
      >
        <svg
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block" }}
        >
          <path
            d={svgPath}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={node.strokeWeight || 0}
          />
        </svg>
      </div>
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
  parentBounds,
}: {
  node: VectorNode;
  scale: number;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  parentBounds?: Rectangle;
}) {
  const containerStyle = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      const relPos = getRelativePosition(node.absoluteBoundingBox, parentBounds, scale);
      if (relPos) {
        s.left = relPos.left;
        s.top = relPos.top;
      }
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
  }, [node, scale, wrapperStyle, renderMode, parentBounds]);

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
            d={vp.path || vp.data || ""}
            fill={fillColor}
            stroke="none"
            fillRule={vp.windingRule === "EVENODD" || vp.windingRule === "ODD" ? "evenodd" : "nonzero"}
          />
        ))}
        {/* Render stroke paths from strokePaths or fallback to vectorPaths with stroke */}
        {node.strokePaths?.map((sp, index) => (
          <path
            key={`stroke-${index}`}
            d={sp.path || sp.data || ""}
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
            d={vp.path || vp.data || ""}
            fill="none"
            stroke={strokeColor}
            strokeWidth={node.strokeWeight || 1}
            strokeLinecap={node.strokeCap === "ROUND" ? "round" : node.strokeCap === "SQUARE" ? "square" : "butt"}
            strokeLinejoin={node.strokeJoin === "ROUND" ? "round" : node.strokeJoin === "BEVEL" ? "bevel" : "miter"}
          />
        ))}
        {/* Fallback to fillGeometry if no vectorPaths */}
        {!node.vectorPaths && node.fillGeometry?.map((geom, index) => (
          <path
            key={`legacy-${index}`}
            d={geom.path || geom.data || ""}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={node.strokeWeight || 0}
            fillRule={geom.windingRule === "EVENODD" ? "evenodd" : "nonzero"}
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
  parentBounds,
}: {
  node: BooleanOperationNode;
  scale: number;
  selectedId?: string;
  onNodeClick?: (node: FigmaNode) => void;
  onClick: (e: React.MouseEvent) => void;
  wrapperStyle: CSSProperties;
  renderMode: "absolute" | "flow";
  showOutlines: boolean;
  parentBounds?: Rectangle;
}) {
  // Boolean operations are complex - we'll render the result as an SVG if possible
  const style = useMemo(() => {
    const s: CSSProperties = {
      ...wrapperStyle,
    };

    if (node.absoluteBoundingBox && renderMode === "absolute") {
      s.position = "absolute";
      const relPos = getRelativePosition(node.absoluteBoundingBox, parentBounds, scale);
      if (relPos) {
        s.left = relPos.left;
        s.top = relPos.top;
      }
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
  }, [node, scale, wrapperStyle, renderMode, parentBounds]);

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
          {node.fillGeometry.map((geom, index) => (
            <path
              key={index}
              d={geom.path || geom.data || ""}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={node.strokeWeight || 0}
              fillRule={geom.windingRule === "EVENODD" ? "evenodd" : "nonzero"}
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
          parentBounds={node.absoluteBoundingBox}
        />
      ))}
    </div>
  );
}

export default FigmaRenderer;
