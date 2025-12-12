"use client";

import React, { useCallback, useState, useRef } from "react";

interface FileUploaderProps {
  onFileLoad: (content: string | ArrayBuffer, filename: string) => void;
  onError: (error: string) => void;
  accept?: string;
  isLoading?: boolean;
}

/**
 * File Upload Component
 * Supports drag-and-drop and click-to-upload for Figma files
 */
export function FileUploader({
  onFileLoad,
  onError,
  accept = ".fig,.json",
  isLoading = false,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const filename = file.name;
      const extension = filename.split(".").pop()?.toLowerCase();

      try {
        if (extension === "json") {
          // Read as text for JSON files
          const text = await file.text();
          onFileLoad(text, filename);
        } else if (extension === "fig") {
          // Read as ArrayBuffer for .fig files
          const buffer = await file.arrayBuffer();
          onFileLoad(buffer, filename);
        } else {
          onError(
            `Unsupported file type: .${extension}. Please upload a .json or .fig file.`
          );
        }
      } catch (err) {
        onError(`Failed to read file: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [onFileLoad, onError]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
      // Reset the input so the same file can be uploaded again
      e.target.value = "";
    },
    [handleFile]
  );

  return (
    <div
      className="file-uploader"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      style={{
        ...uploaderStyle,
        borderColor: isDragging ? "#4f46e5" : "#d1d5db",
        backgroundColor: isDragging ? "#eef2ff" : "#f9fafb",
        cursor: isLoading ? "wait" : "pointer",
        opacity: isLoading ? 0.7 : 1,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        style={{ display: "none" }}
        disabled={isLoading}
      />

      {isLoading ? (
        <div style={loadingStyle}>
          <div style={spinnerStyle} />
          <span style={{ marginTop: 12, color: "#6b7280" }}>Processing file...</span>
        </div>
      ) : (
        <>
          <div style={iconStyle}>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isDragging ? "#4f46e5" : "#9ca3af"}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          <div style={textStyle}>
            <p style={{ margin: 0, fontWeight: 500, color: "#374151" }}>
              {isDragging ? "Drop your file here" : "Upload Figma File"}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#6b7280" }}>
              Drag and drop or click to select
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>
              Supports .fig and .json exports
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Sample File Loader
 * Allows loading sample Figma files for demonstration
 */
interface SampleLoaderProps {
  onLoadSample: (content: string) => void;
}

export function SampleFileLoader({ onLoadSample }: SampleLoaderProps) {
  const handleLoadSample = useCallback(() => {
    // Create a sample Figma document structure
    const sampleDocument = createSampleDocument();
    onLoadSample(JSON.stringify(sampleDocument, null, 2));
  }, [onLoadSample]);

  return (
    <div style={sampleLoaderStyle}>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
        Don't have a Figma file? Try a sample:
      </p>
      <button onClick={handleLoadSample} style={sampleButtonStyle}>
        Load Sample Document
      </button>
    </div>
  );
}

/**
 * Create a sample Figma document for demonstration
 */
function createSampleDocument() {
  return {
    name: "Sample Figma Document",
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
            // Header Frame
            {
              id: "2:0",
              name: "Header",
              type: "FRAME",
              visible: true,
              absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 80 },
              size: { x: 800, y: 80 },
              fills: [{ type: "SOLID", color: { r: 0.26, g: 0.35, b: 0.85, a: 1 } }],
              layoutMode: "HORIZONTAL",
              primaryAxisAlignItems: "SPACE_BETWEEN",
              counterAxisAlignItems: "CENTER",
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 16,
              paddingBottom: 16,
              children: [
                {
                  id: "2:1",
                  name: "Logo",
                  type: "TEXT",
                  characters: "Elementary School Planner",
                  absoluteBoundingBox: { x: 24, y: 28, width: 200, height: 24 },
                  style: {
                    fontFamily: "Inter",
                    fontWeight: 700,
                    fontSize: 20,
                    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                  },
                  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                },
                {
                  id: "2:2",
                  name: "Navigation",
                  type: "FRAME",
                  absoluteBoundingBox: { x: 500, y: 24, width: 276, height: 32 },
                  layoutMode: "HORIZONTAL",
                  itemSpacing: 24,
                  counterAxisAlignItems: "CENTER",
                  children: [
                    {
                      id: "2:3",
                      name: "Nav - Home",
                      type: "TEXT",
                      characters: "Home",
                      style: {
                        fontFamily: "Inter",
                        fontWeight: 500,
                        fontSize: 14,
                        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.9 } }],
                      },
                      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.9 } }],
                    },
                    {
                      id: "2:4",
                      name: "Nav - Lessons",
                      type: "TEXT",
                      characters: "Lessons",
                      style: {
                        fontFamily: "Inter",
                        fontWeight: 500,
                        fontSize: 14,
                        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.9 } }],
                      },
                      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.9 } }],
                    },
                    {
                      id: "2:5",
                      name: "Nav - Schedule",
                      type: "TEXT",
                      characters: "Schedule",
                      style: {
                        fontFamily: "Inter",
                        fontWeight: 500,
                        fontSize: 14,
                        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.9 } }],
                      },
                      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 0.9 } }],
                    },
                  ],
                },
              ],
            },

            // Main Content
            {
              id: "3:0",
              name: "Main Content",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 80, width: 800, height: 520 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
              layoutMode: "VERTICAL",
              paddingLeft: 32,
              paddingRight: 32,
              paddingTop: 32,
              paddingBottom: 32,
              itemSpacing: 24,
              children: [
                // Title
                {
                  id: "3:1",
                  name: "Page Title",
                  type: "TEXT",
                  characters: "Weekly Lesson Plan",
                  style: {
                    fontFamily: "Inter",
                    fontWeight: 700,
                    fontSize: 28,
                    fills: [{ type: "SOLID", color: { r: 0.12, g: 0.12, b: 0.12, a: 1 } }],
                  },
                  fills: [{ type: "SOLID", color: { r: 0.12, g: 0.12, b: 0.12, a: 1 } }],
                },

                // Lesson Cards Container
                {
                  id: "4:0",
                  name: "Lesson Cards",
                  type: "FRAME",
                  absoluteBoundingBox: { x: 32, y: 172, width: 736, height: 380 },
                  layoutMode: "HORIZONTAL",
                  layoutWrap: "WRAP",
                  itemSpacing: 16,
                  counterAxisSpacing: 16,
                  children: [
                    // Monday Card
                    createLessonCard("5:0", "Monday", "Math - Addition", "Learn basic addition with numbers 1-10. Practice counting objects.", "#ef4444"),
                    // Tuesday Card
                    createLessonCard("5:1", "Tuesday", "Reading - Phonics", "Letter sounds A-F. Practice blending sounds to read simple words.", "#f59e0b"),
                    // Wednesday Card
                    createLessonCard("5:2", "Wednesday", "Science - Plants", "Parts of a plant. Observe and draw different leaves.", "#22c55e"),
                    // Thursday Card
                    createLessonCard("5:3", "Thursday", "Art - Colors", "Primary and secondary colors. Create a color wheel painting.", "#8b5cf6"),
                    // Friday Card
                    createLessonCard("5:4", "Friday", "Music - Rhythm", "Clapping patterns. Learn simple songs with movement.", "#ec4899"),
                  ],
                },
              ],
            },

            // Decorative Shapes
            {
              id: "6:0",
              name: "Decoration Circle",
              type: "ELLIPSE",
              absoluteBoundingBox: { x: 720, y: 500, width: 100, height: 100 },
              fills: [{ type: "SOLID", color: { r: 0.26, g: 0.35, b: 0.85, a: 0.1 } }],
            },
            {
              id: "6:1",
              name: "Decoration Rectangle",
              type: "RECTANGLE",
              absoluteBoundingBox: { x: -20, y: 450, width: 60, height: 60 },
              fills: [{ type: "SOLID", color: { r: 0.95, g: 0.62, b: 0.07, a: 0.15 } }],
              cornerRadius: 8,
            },
          ],
        },
      ],
    },
  };
}

function createLessonCard(id: string, day: string, subject: string, description: string, accentColor: string) {
  // Parse hex color to RGB
  const r = parseInt(accentColor.slice(1, 3), 16) / 255;
  const g = parseInt(accentColor.slice(3, 5), 16) / 255;
  const b = parseInt(accentColor.slice(5, 7), 16) / 255;

  return {
    id,
    name: `Lesson Card - ${day}`,
    type: "FRAME" as const,
    absoluteBoundingBox: { x: 0, y: 0, width: 230, height: 170 },
    size: { x: 230, y: 170 },
    fills: [{ type: "SOLID" as const, color: { r: 0.98, g: 0.98, b: 0.98, a: 1 } }],
    strokes: [{ type: "SOLID" as const, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
    strokeWeight: 1,
    cornerRadius: 12,
    effects: [
      {
        type: "DROP_SHADOW" as const,
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.08 },
        offset: { x: 0, y: 2 },
        radius: 8,
        spread: 0,
      },
    ],
    layoutMode: "VERTICAL" as const,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    paddingBottom: 16,
    itemSpacing: 8,
    children: [
      {
        id: `${id}:1`,
        name: "Day Label",
        type: "TEXT" as const,
        characters: day,
        style: {
          fontFamily: "Inter",
          fontWeight: 600,
          fontSize: 12,
          fills: [{ type: "SOLID" as const, color: { r, g, b, a: 1 } }],
        },
        fills: [{ type: "SOLID" as const, color: { r, g, b, a: 1 } }],
      },
      {
        id: `${id}:2`,
        name: "Subject",
        type: "TEXT" as const,
        characters: subject,
        style: {
          fontFamily: "Inter",
          fontWeight: 600,
          fontSize: 16,
          fills: [{ type: "SOLID" as const, color: { r: 0.12, g: 0.12, b: 0.12, a: 1 } }],
        },
        fills: [{ type: "SOLID" as const, color: { r: 0.12, g: 0.12, b: 0.12, a: 1 } }],
      },
      {
        id: `${id}:3`,
        name: "Description",
        type: "TEXT" as const,
        characters: description,
        style: {
          fontFamily: "Inter",
          fontWeight: 400,
          fontSize: 13,
          lineHeightPx: 18,
          fills: [{ type: "SOLID" as const, color: { r: 0.4, g: 0.4, b: 0.4, a: 1 } }],
        },
        fills: [{ type: "SOLID" as const, color: { r: 0.4, g: 0.4, b: 0.4, a: 1 } }],
      },
      {
        id: `${id}:4`,
        name: "Accent Bar",
        type: "RECTANGLE" as const,
        absoluteBoundingBox: { x: 0, y: 0, width: 198, height: 4 },
        size: { x: 198, y: 4 },
        fills: [{ type: "SOLID" as const, color: { r, g, b, a: 1 } }],
        cornerRadius: 2,
      },
    ],
  };
}

// Styles
const uploaderStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 40,
  border: "2px dashed",
  borderRadius: 12,
  transition: "all 0.2s ease",
  minHeight: 200,
};

const iconStyle: React.CSSProperties = {
  marginBottom: 16,
};

const textStyle: React.CSSProperties = {
  textAlign: "center",
};

const loadingStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const spinnerStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "3px solid #e5e7eb",
  borderTop: "3px solid #4f46e5",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};

const sampleLoaderStyle: React.CSSProperties = {
  textAlign: "center",
  marginTop: 24,
  paddingTop: 24,
  borderTop: "1px solid #e5e7eb",
};

const sampleButtonStyle: React.CSSProperties = {
  padding: "10px 20px",
  backgroundColor: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  color: "#374151",
  transition: "all 0.2s ease",
};

export default FileUploader;
