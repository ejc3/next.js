"use client";

import React, { useState, useCallback, useMemo } from "react";
import type { ComponentTreeNode, FigmaNode, NodeType } from "../lib/figma-types";

interface ComponentTreeProps {
  tree: ComponentTreeNode | null;
  selectedId?: string;
  onNodeSelect?: (id: string) => void;
  expandAll?: boolean;
  searchQuery?: string;
}

// Node type icons/colors
const nodeTypeStyles: Record<NodeType, { icon: string; color: string }> = {
  DOCUMENT: { icon: "📄", color: "#6366f1" },
  CANVAS: { icon: "📋", color: "#8b5cf6" },
  PAGE: { icon: "📋", color: "#8b5cf6" },
  FRAME: { icon: "⬜", color: "#3b82f6" },
  GROUP: { icon: "📁", color: "#f59e0b" },
  VECTOR: { icon: "✏️", color: "#10b981" },
  BOOLEAN_OPERATION: { icon: "🔗", color: "#f97316" },
  STAR: { icon: "⭐", color: "#eab308" },
  LINE: { icon: "➖", color: "#64748b" },
  ELLIPSE: { icon: "⚪", color: "#ec4899" },
  REGULAR_POLYGON: { icon: "🔷", color: "#14b8a6" },
  POLYGON: { icon: "🔷", color: "#14b8a6" },
  RECTANGLE: { icon: "⬛", color: "#06b6d4" },
  ROUNDED_RECTANGLE: { icon: "⬛", color: "#06b6d4" },
  TABLE: { icon: "📊", color: "#8b5cf6" },
  TABLE_CELL: { icon: "🔲", color: "#a78bfa" },
  TEXT: { icon: "T", color: "#ef4444" },
  TEXT_PATH: { icon: "T~", color: "#ef4444" },
  SLICE: { icon: "✂️", color: "#78716c" },
  COMPONENT: { icon: "◆", color: "#22c55e" },
  COMPONENT_SET: { icon: "◇", color: "#16a34a" },
  INSTANCE: { icon: "◈", color: "#84cc16" },
  SYMBOL: { icon: "◈", color: "#84cc16" },
  STICKY: { icon: "📝", color: "#fbbf24" },
  SHAPE_WITH_TEXT: { icon: "💬", color: "#f472b6" },
  CONNECTOR: { icon: "↗️", color: "#94a3b8" },
  WASHI_TAPE: { icon: "🎗️", color: "#fb923c" },
  STAMP: { icon: "🔖", color: "#fb923c" },
  HIGHLIGHT: { icon: "🖍️", color: "#fbbf24" },
  CODE_BLOCK: { icon: "💻", color: "#64748b" },
  SECTION: { icon: "📦", color: "#a855f7" },
  EMBED: { icon: "🔗", color: "#94a3b8" },
  LINK_UNFURL: { icon: "🔗", color: "#94a3b8" },
  MEDIA: { icon: "🎬", color: "#8b5cf6" },
  WIDGET: { icon: "🧩", color: "#22c55e" },
  SLIDE: { icon: "📑", color: "#8b5cf6" },
  SLIDE_ROW: { icon: "📑", color: "#a78bfa" },
  SLIDE_GRID: { icon: "📑", color: "#a78bfa" },
  INTERACTIVE_SLIDE_ELEMENT: { icon: "📑", color: "#a78bfa" },
  TRANSFORM_GROUP: { icon: "🔄", color: "#f59e0b" },
};

/**
 * Component Tree Viewer
 * Displays the hierarchical structure of a Figma document
 */
export function ComponentTree({
  tree,
  selectedId,
  onNodeSelect,
  expandAll = false,
  searchQuery = "",
}: ComponentTreeProps) {
  if (!tree) {
    return (
      <div className="component-tree-empty">
        <p style={{ color: "#666", padding: "16px" }}>
          No document loaded. Upload a Figma file to see the component tree.
        </p>
      </div>
    );
  }

  return (
    <div className="component-tree" style={treeContainerStyle}>
      <TreeNode
        node={tree}
        selectedId={selectedId}
        onNodeSelect={onNodeSelect}
        level={0}
        defaultExpanded={expandAll}
        searchQuery={searchQuery.toLowerCase()}
      />
    </div>
  );
}

interface TreeNodeProps {
  node: ComponentTreeNode;
  selectedId?: string;
  onNodeSelect?: (id: string) => void;
  level: number;
  defaultExpanded: boolean;
  searchQuery: string;
}

function TreeNode({
  node,
  selectedId,
  onNodeSelect,
  level,
  defaultExpanded,
  searchQuery,
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(
    defaultExpanded || level < 2 || node.type === "DOCUMENT"
  );

  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;

  // Check if this node or any children match the search
  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true;

    const nodeMatches = node.name.toLowerCase().includes(searchQuery) ||
                        node.type.toLowerCase().includes(searchQuery);

    if (nodeMatches) return true;

    // Check children recursively
    const checkChildren = (children: ComponentTreeNode[] | undefined): boolean => {
      if (!children) return false;
      return children.some(
        (child) =>
          child.name.toLowerCase().includes(searchQuery) ||
          child.type.toLowerCase().includes(searchQuery) ||
          checkChildren(child.children)
      );
    };

    return checkChildren(node.children);
  }, [node, searchQuery]);

  // Auto-expand when searching
  React.useEffect(() => {
    if (searchQuery && matchesSearch && hasChildren) {
      setIsExpanded(true);
    }
  }, [searchQuery, matchesSearch, hasChildren]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  const handleSelect = useCallback(() => {
    onNodeSelect?.(node.id);
  }, [node.id, onNodeSelect]);

  if (!matchesSearch) {
    return null;
  }

  const typeStyle = nodeTypeStyles[node.type] || { icon: "?", color: "#666" };
  const isHighlighted = searchQuery && (
    node.name.toLowerCase().includes(searchQuery) ||
    node.type.toLowerCase().includes(searchQuery)
  );

  return (
    <div className="tree-node">
      <div
        className="tree-node-row"
        onClick={handleSelect}
        style={{
          ...nodeRowStyle,
          paddingLeft: level * 16 + 8,
          backgroundColor: isSelected
            ? "#e0e7ff"
            : isHighlighted
            ? "#fef3c7"
            : "transparent",
          borderLeft: isSelected ? "3px solid #4f46e5" : "3px solid transparent",
        }}
      >
        {hasChildren ? (
          <button
            onClick={handleToggle}
            style={expandButtonStyle}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        ) : (
          <span style={{ width: 20, display: "inline-block" }} />
        )}

        <span
          style={{
            ...nodeIconStyle,
            color: typeStyle.color,
          }}
          title={node.type}
        >
          {typeStyle.icon}
        </span>

        <span
          style={{
            ...nodeNameStyle,
            opacity: node.visible === false ? 0.5 : 1,
            textDecoration: node.visible === false ? "line-through" : "none",
          }}
        >
          {node.name || "(unnamed)"}
        </span>

        <span style={nodeTypeStyle}>{node.type}</span>

        {node.visible === false && (
          <span style={hiddenBadgeStyle} title="Hidden">
            👁️‍🗨️
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="tree-node-children">
          {node.children!.map((child, index) => (
            <TreeNode
              key={child.id || index}
              node={child}
              selectedId={selectedId}
              onNodeSelect={onNodeSelect}
              level={level + 1}
              defaultExpanded={defaultExpanded}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Styles
const treeContainerStyle: React.CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 13,
  lineHeight: 1.5,
  overflow: "auto",
  height: "100%",
};

const nodeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "4px 8px",
  cursor: "pointer",
  borderRadius: 4,
  marginRight: 4,
  transition: "background-color 0.15s ease",
};

const expandButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "2px 4px",
  cursor: "pointer",
  fontSize: 10,
  color: "#666",
  width: 20,
  textAlign: "center",
};

const nodeIconStyle: React.CSSProperties = {
  marginRight: 6,
  fontSize: 14,
  width: 18,
  textAlign: "center",
};

const nodeNameStyle: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#1f2937",
};

const nodeTypeStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#9ca3af",
  marginLeft: 8,
  padding: "1px 4px",
  backgroundColor: "#f3f4f6",
  borderRadius: 3,
};

const hiddenBadgeStyle: React.CSSProperties = {
  marginLeft: 4,
  fontSize: 12,
  opacity: 0.5,
};

/**
 * Tree Statistics Component
 */
interface TreeStatsProps {
  stats: {
    totalNodes: number;
    nodesByType: Record<string, number>;
    pageCount: number;
    componentCount: number;
    textNodes: number;
  };
}

export function TreeStats({ stats }: TreeStatsProps) {
  return (
    <div style={statsContainerStyle}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 14, color: "#374151" }}>
        Document Statistics
      </h3>

      <div style={statsGridStyle}>
        <StatCard label="Total Nodes" value={stats.totalNodes} />
        <StatCard label="Pages" value={stats.pageCount} />
        <StatCard label="Components" value={stats.componentCount} />
        <StatCard label="Text Nodes" value={stats.textNodes} />
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 12, color: "#6b7280" }}>
          Nodes by Type
        </h4>
        <div style={typeListStyle}>
          {Object.entries(stats.nodesByType)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
              const typeStyle = nodeTypeStyles[type as NodeType] || { icon: "?", color: "#666" };
              return (
                <div key={type} style={typeItemStyle}>
                  <span style={{ color: typeStyle.color }}>{typeStyle.icon}</span>
                  <span style={{ flex: 1 }}>{type}</span>
                  <span style={{ color: "#6b7280" }}>{count}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={statCardStyle}>
      <div style={{ fontSize: 20, fontWeight: 600, color: "#1f2937" }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
    </div>
  );
}

const statsContainerStyle: React.CSSProperties = {
  padding: 16,
  backgroundColor: "#fff",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 12,
};

const statCardStyle: React.CSSProperties = {
  padding: 12,
  backgroundColor: "#f9fafb",
  borderRadius: 6,
  textAlign: "center",
};

const typeListStyle: React.CSSProperties = {
  maxHeight: 200,
  overflow: "auto",
};

const typeItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 0",
  fontSize: 12,
  borderBottom: "1px solid #f3f4f6",
};

/**
 * Text Content Extractor Component
 */
interface TextContentProps {
  textNodes: { id: string; name: string; text: string }[];
  onNodeSelect?: (id: string) => void;
}

export function TextContentList({ textNodes, onNodeSelect }: TextContentProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredNodes = useMemo(() => {
    if (!searchTerm) return textNodes;
    const term = searchTerm.toLowerCase();
    return textNodes.filter(
      (node) =>
        node.name.toLowerCase().includes(term) ||
        node.text.toLowerCase().includes(term)
    );
  }, [textNodes, searchTerm]);

  return (
    <div style={textListContainerStyle}>
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search text content..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={searchInputStyle}
        />
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        {filteredNodes.length} text node{filteredNodes.length !== 1 ? "s" : ""} found
      </div>

      <div style={textListStyle}>
        {filteredNodes.map((node) => (
          <div
            key={node.id}
            style={textItemStyle}
            onClick={() => onNodeSelect?.(node.id)}
          >
            <div style={textItemHeaderStyle}>
              <span style={{ color: "#ef4444" }}>T</span>
              <span style={{ flex: 1, fontWeight: 500 }}>{node.name}</span>
            </div>
            <div style={textItemContentStyle}>{node.text || "(empty)"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const textListContainerStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  outline: "none",
};

const textListStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
};

const textItemStyle: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #e5e7eb",
  cursor: "pointer",
  transition: "background-color 0.15s ease",
};

const textItemHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "#374151",
  marginBottom: 4,
};

const textItemContentStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export default ComponentTree;
