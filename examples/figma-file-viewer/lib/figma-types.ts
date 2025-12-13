/**
 * Figma File Format Type Definitions
 * Comprehensive types for parsing and rendering Figma files
 */

// Base Types
export type GUID = string;

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Vector {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

// Paint Types
export type PaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE"
  | "EMOJI"
  | "VIDEO";

export interface ColorStop {
  position: number;
  color: Color;
}

export interface Paint {
  type: PaintType;
  visible?: boolean;
  opacity?: number;
  color?: Color;
  blendMode?: BlendMode;
  gradientHandlePositions?: Vector[];
  gradientStops?: ColorStop[];
  scaleMode?: "FILL" | "FIT" | "TILE" | "STRETCH";
  imageTransform?: Transform[];
  scalingFactor?: number;
  rotation?: number;
  imageRef?: string;
  gifRef?: string;
  filters?: ImageFilters;
}

export interface ImageFilters {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}

// Effect Types
export type EffectType =
  | "INNER_SHADOW"
  | "DROP_SHADOW"
  | "LAYER_BLUR"
  | "BACKGROUND_BLUR";

export interface Effect {
  type: EffectType;
  visible?: boolean;
  radius: number;
  color?: Color;
  blendMode?: BlendMode;
  offset?: Vector;
  spread?: number;
  showShadowBehindNode?: boolean;
}

// Stroke Types
export type StrokeAlign = "INSIDE" | "OUTSIDE" | "CENTER";
export type StrokeCap = "NONE" | "ROUND" | "SQUARE" | "LINE_ARROW" | "TRIANGLE_ARROW";
export type StrokeJoin = "MITER" | "BEVEL" | "ROUND";

// Constraint Types
export type ConstraintType =
  | "MIN"
  | "CENTER"
  | "MAX"
  | "STRETCH"
  | "SCALE";

export interface Constraint {
  type: ConstraintType;
  value: number;
}

export interface Constraints {
  vertical: ConstraintType;
  horizontal: ConstraintType;
}

// Layout Types
export type LayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL";
export type LayoutAlign = "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
export type LayoutSizingMode = "FIXED" | "HUG" | "FILL";
export type LayoutWrap = "NO_WRAP" | "WRAP";
export type PrimaryAxisAlignItems = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" | "SPACE_EVENLY";
export type CounterAxisAlignItems = "MIN" | "CENTER" | "MAX" | "BASELINE" | "STRETCH" | "AUTO";

// Blend Modes
export type BlendMode =
  | "PASS_THROUGH"
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "LINEAR_BURN"
  | "COLOR_BURN"
  | "LIGHTEN"
  | "SCREEN"
  | "LINEAR_DODGE"
  | "COLOR_DODGE"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

// Text Types
export type TextAlignHorizontal = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
export type TextAlignVertical = "TOP" | "CENTER" | "BOTTOM";
export type TextAutoResize = "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";
export type TextDecoration = "NONE" | "UNDERLINE" | "STRIKETHROUGH";
export type TextCase = "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
export type LineHeightUnit = "PIXELS" | "FONT_SIZE_%" | "INTRINSIC_%";
export type TextTruncation = "DISABLED" | "ENDING";

export interface TextBaseline {
  position: Vector;
  width: number;
  lineHeight: number;
  lineAscent: number;
  firstCharacter: number;
  endCharacter: number;
}

export interface TypeStyle {
  fontFamily: string;
  fontPostScriptName?: string;
  fontWeight: number;
  fontSize: number;
  fontStyle?: string;
  textAlignHorizontal?: TextAlignHorizontal;
  textAlignVertical?: TextAlignVertical;
  letterSpacing?: number;
  letterSpacingUnit?: "PIXELS" | "PERCENT";
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: LineHeightUnit;
  paragraphSpacing?: number;
  textDecoration?: TextDecoration;
  textCase?: TextCase;
  textAutoResize?: TextAutoResize;
  textTruncation?: TextTruncation;
  maxLines?: number;
  fills?: Paint[];
  hyperlink?: Hyperlink;
  opentypeFlags?: { [key: string]: number };
  italic?: boolean;
}

export interface Hyperlink {
  type: "URL" | "NODE";
  url?: string;
  nodeID?: string;
}

// Path Types
export interface PathSegment {
  start: number;
  end: number;
  tangentStart?: Vector;
  tangentEnd?: Vector;
}

export interface VectorPath {
  windingRule: "EVENODD" | "NONZERO" | "ODD";
  data?: string;
  path?: string; // Alternative name used by parser
}

export interface VectorVertex {
  x: number;
  y: number;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  cornerRadius?: number;
  handleMirroring?: "NONE" | "ANGLE" | "ANGLE_AND_LENGTH";
}

// Node Types - Comprehensive list from Figma API
// See: https://www.figma.com/plugin-docs/api/nodes/
export type NodeType =
  // Document & Structure
  | "DOCUMENT"
  | "CANVAS"        // Also known as PAGE in Plugin API
  | "PAGE"          // Plugin API name for canvas
  | "FRAME"
  | "GROUP"
  | "SECTION"
  // Shapes & Vectors
  | "VECTOR"
  | "BOOLEAN_OPERATION"
  | "STAR"
  | "LINE"
  | "ELLIPSE"
  | "REGULAR_POLYGON"
  | "POLYGON"       // Alternative name
  | "RECTANGLE"
  | "ROUNDED_RECTANGLE"  // Internal fig-kiwi type
  // Tables
  | "TABLE"
  | "TABLE_CELL"
  // Text
  | "TEXT"
  | "TEXT_PATH"     // Beta feature
  // Components
  | "COMPONENT"
  | "COMPONENT_SET"
  | "INSTANCE"
  | "SYMBOL"        // Internal fig-kiwi type
  // Slicing & Export
  | "SLICE"
  // FigJam & Collaboration
  | "STICKY"
  | "SHAPE_WITH_TEXT"
  | "CONNECTOR"
  | "WASHI_TAPE"
  | "STAMP"
  | "HIGHLIGHT"
  | "CODE_BLOCK"
  // Embeds & Media
  | "EMBED"
  | "LINK_UNFURL"
  | "MEDIA"
  | "WIDGET"
  // Slides (FigJam/Presentation)
  | "SLIDE"
  | "SLIDE_ROW"
  | "SLIDE_GRID"
  | "INTERACTIVE_SLIDE_ELEMENT"
  // Advanced
  | "TRANSFORM_GROUP";

// Base Node
export interface BaseNode {
  id: GUID;
  name: string;
  type: NodeType;
  visible?: boolean;
  locked?: boolean;
  pluginData?: { [key: string]: string };
  sharedPluginData?: { [key: string]: { [key: string]: string } };
  componentPropertyReferences?: { [key: string]: string };
  boundVariables?: { [key: string]: VariableAlias | VariableAlias[] };
  explicitVariableModes?: { [key: string]: string };
}

export interface VariableAlias {
  type: "VARIABLE_ALIAS";
  id: string;
}

// Scene Node (nodes with transforms)
export interface SceneNode extends BaseNode {
  rotation?: number;
  absoluteBoundingBox?: Rectangle;
  absoluteRenderBounds?: Rectangle;
  relativeTransform?: number[][];
  size?: Vector;
  constraints?: Constraints;
  layoutAlign?: LayoutAlign;
  layoutGrow?: number;
  layoutSizingHorizontal?: LayoutSizingMode;
  layoutSizingVertical?: LayoutSizingMode;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  isMask?: boolean;
  maskType?: "ALPHA" | "LUMINANCE";
  // Scale stroke/effects independently from node scaling
  strokesIndependent?: boolean;
  effectsIndependent?: boolean;
  // Prototype interactions (click, hover, drag, etc.)
  prototypeInteractions?: PrototypeInteraction[];
}

// Geometry Mixin
export interface GeometryMixin {
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: StrokeAlign;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  strokeDashes?: number[];
  strokeMiterAngle?: number;
  fillGeometry?: VectorPath[];
  strokeGeometry?: VectorPath[];
  fillOverrideTable?: { [key: number]: Paint };
  individualStrokeWeights?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

// Corner Mixin
export interface CornerMixin {
  cornerRadius?: number;
  cornerSmoothing?: number;
  rectangleCornerRadii?: [number, number, number, number];
}

// Blend Mixin
export interface BlendMixin {
  opacity?: number;
  blendMode?: BlendMode;
  isMask?: boolean;
  effects?: Effect[];
  isMaskOutline?: boolean;
}

// Container Mixin (for frames, groups)
export interface ContainerMixin {
  children?: FigmaNode[];
  clipsContent?: boolean;
}

// Layout Mixin (for auto layout)
export interface LayoutMixin {
  layoutMode?: LayoutMode;
  layoutWrap?: LayoutWrap;
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  counterAxisAlignContent?: "AUTO" | "SPACE_BETWEEN";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  itemReverseZIndex?: boolean;
  strokesIncludedInLayout?: boolean;
  overflowDirection?: "NONE" | "HORIZONTAL_SCROLLING" | "VERTICAL_SCROLLING" | "HORIZONTAL_AND_VERTICAL_SCROLLING";
}

// Document Node
export interface DocumentNode extends BaseNode {
  type: "DOCUMENT";
  children: CanvasNode[];
}

// Canvas Node (Page)
export interface CanvasNode extends BaseNode {
  type: "CANVAS";
  children: FigmaNode[];
  backgroundColor: Color;
  prototypeStartNodeID?: string;
  flowStartingPoints?: FlowStartingPoint[];
  prototypeDevice?: PrototypeDevice;
}

export interface FlowStartingPoint {
  nodeId: string;
  name: string;
}

export interface PrototypeDevice {
  type: "NONE" | "PRESET" | "CUSTOM";
  size?: Vector;
  presetIdentifier?: string;
  rotation: "NONE" | "CCW_90";
}

// Prototype Interactions
export type InteractionType =
  | "ON_CLICK"
  | "ON_DRAG"
  | "DRAG"
  | "ON_HOVER"
  | "MOUSE_ENTER"
  | "MOUSE_LEAVE"
  | "MOUSE_UP"
  | "MOUSE_DOWN"
  | "ON_PRESS"
  | "AFTER_TIMEOUT"
  | "ON_KEY_DOWN";

export type TransitionType =
  | "INSTANT"
  | "DISSOLVE"
  | "SMART_ANIMATE"
  | "MOVE_IN"
  | "MOVE_OUT"
  | "PUSH"
  | "SLIDE_IN"
  | "SLIDE_OUT";

export type EasingType =
  | "EASE_IN"
  | "EASE_OUT"
  | "EASE_IN_AND_OUT"
  | "LINEAR"
  | "EASE_IN_BACK"
  | "EASE_OUT_BACK"
  | "EASE_IN_AND_OUT_BACK"
  | "CUSTOM_CUBIC_BEZIER"
  | "GENTLE"
  | "QUICK"
  | "BOUNCY"
  | "SLOW"
  | "CUSTOM_SPRING"
  | "OUT_CUBIC"
  | "IN_CUBIC";

export type NavigationType =
  | "NAVIGATE"
  | "SWAP"
  | "OVERLAY"
  | "SCROLL_TO"
  | "CHANGE_TO";

export interface PrototypeAction {
  transitionNodeID?: string;
  transitionType?: TransitionType;
  transitionDuration?: number;
  easingType?: EasingType;
  easingFunction?: number[];
  connectionType?: "INTERNAL_NODE" | "EXTERNAL_URL";
  navigationType?: NavigationType;
  transitionPreserveScroll?: boolean;
  url?: string;
}

export interface PrototypeInteraction {
  id?: string;
  event: {
    interactionType: InteractionType;
    delay?: number;
    keyCode?: number;
  };
  actions: PrototypeAction[];
  isDeleted?: boolean;
}

// Frame Node
export interface FrameNode
  extends SceneNode,
    GeometryMixin,
    CornerMixin,
    BlendMixin,
    ContainerMixin,
    LayoutMixin {
  type: "FRAME" | "COMPONENT" | "COMPONENT_SET" | "INSTANCE" | "SYMBOL" | "SECTION" | "SLIDE" | "SLIDE_ROW" | "SLIDE_GRID" | "TRANSFORM_GROUP" | "WIDGET" | "EMBED" | "MEDIA" | "LINK_UNFURL";
  componentId?: string;
  componentKey?: string;
  isExposedInstance?: boolean;
  exposedInstances?: string[];
  componentProperties?: { [key: string]: ComponentProperty };
  overrides?: Override[];
}

export interface ComponentProperty {
  type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "VARIANT";
  value: boolean | string;
  preferredValues?: InstanceSwapPreferredValue[];
  boundVariables?: { [key: string]: VariableAlias };
}

export interface InstanceSwapPreferredValue {
  type: "COMPONENT" | "COMPONENT_SET";
  key: string;
}

export interface Override {
  id: string;
  overriddenFields: string[];
}

// Group Node
export interface GroupNode
  extends SceneNode,
    BlendMixin,
    ContainerMixin {
  type: "GROUP" | "STICKY" | "SHAPE_WITH_TEXT" | "CONNECTOR" | "CODE_BLOCK";
}

// Section Node
export interface SectionNode extends BaseNode, ContainerMixin {
  type: "SECTION";
  sectionContentsHidden?: boolean;
  fills?: Paint[];
  absoluteBoundingBox?: Rectangle;
  absoluteRenderBounds?: Rectangle;
}

// Vector Node
export interface VectorNode
  extends SceneNode,
    GeometryMixin,
    CornerMixin,
    BlendMixin {
  type: "VECTOR" | "LINE" | "REGULAR_POLYGON" | "POLYGON" | "STAR" | "ELLIPSE" | "RECTANGLE" | "ROUNDED_RECTANGLE" | "TEXT_PATH" | "SLICE" | "STAMP" | "HIGHLIGHT" | "WASHI_TAPE" | "INTERACTIVE_SLIDE_ELEMENT";
  vectorPaths?: VectorPath[];
  strokePaths?: VectorPath[];
  handleMirroring?: "NONE" | "ANGLE" | "ANGLE_AND_LENGTH";
  arcData?: ArcData;
}

export interface ArcData {
  startingAngle: number;
  endingAngle: number;
  innerRadius: number;
}

// Boolean Operation Node
export interface BooleanOperationNode
  extends SceneNode,
    GeometryMixin,
    CornerMixin,
    BlendMixin,
    ContainerMixin {
  type: "BOOLEAN_OPERATION";
  booleanOperation: "UNION" | "INTERSECT" | "SUBTRACT" | "EXCLUDE";
}

// Text Node
export interface TextNode
  extends SceneNode,
    GeometryMixin,
    BlendMixin {
  type: "TEXT";
  characters: string;
  style?: TypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: { [key: number]: TypeStyle };
  lineTypes?: ("ORDERED" | "UNORDERED" | "NONE")[];
  lineIndentations?: number[];
  textAutoResize?: TextAutoResize;
  textTruncation?: TextTruncation;
  maxLines?: number;
  textBaselines?: TextBaseline[];
}

// Table Node
export interface TableNode extends SceneNode, BlendMixin {
  type: "TABLE";
  children: TableCellNode[];
}

export interface TableCellNode extends SceneNode, GeometryMixin, BlendMixin {
  type: "TABLE_CELL";
  children?: FigmaNode[];
}

// Slice Node
export interface SliceNode extends SceneNode {
  type: "SLICE";
  exportSettings?: ExportSetting[];
}

export interface ExportSetting {
  suffix: string;
  format: "JPG" | "PNG" | "SVG" | "PDF";
  constraint: ExportConstraint;
}

export interface ExportConstraint {
  type: "SCALE" | "WIDTH" | "HEIGHT";
  value: number;
}

// Sticky Note
export interface StickyNode extends SceneNode, BlendMixin {
  type: "STICKY";
  characters: string;
  authorVisible?: boolean;
}

// Connector
export interface ConnectorNode extends SceneNode, GeometryMixin, BlendMixin {
  type: "CONNECTOR";
  characters?: string;
  connectorStart: ConnectorEndpoint;
  connectorEnd: ConnectorEndpoint;
  connectorStartStrokeCap?: string;
  connectorEndStrokeCap?: string;
  connectorLineType?: "ELBOWED" | "STRAIGHT";
  textBackground?: ConnectorTextBackground;
}

export interface ConnectorEndpoint {
  endpointNodeId?: string;
  position?: Vector;
  magnet?: "AUTO" | "TOP" | "BOTTOM" | "LEFT" | "RIGHT";
}

export interface ConnectorTextBackground {
  cornerRadius?: number;
  fills?: Paint[];
}

// Shape with Text (Figjam shapes)
export interface ShapeWithTextNode extends SceneNode, GeometryMixin, BlendMixin {
  type: "SHAPE_WITH_TEXT";
  characters: string;
  shapeType:
    | "SQUARE"
    | "ELLIPSE"
    | "ROUNDED_RECTANGLE"
    | "DIAMOND"
    | "TRIANGLE_UP"
    | "TRIANGLE_DOWN"
    | "PARALLELOGRAM_RIGHT"
    | "PARALLELOGRAM_LEFT"
    | "ENG_DATABASE"
    | "ENG_QUEUE"
    | "ENG_FILE"
    | "ENG_FOLDER";
}

// Union type for all node types
export type FigmaNode =
  | DocumentNode
  | CanvasNode
  | FrameNode
  | GroupNode
  | SectionNode
  | VectorNode
  | BooleanOperationNode
  | TextNode
  | TableNode
  | TableCellNode
  | SliceNode
  | StickyNode
  | ConnectorNode
  | ShapeWithTextNode;

// File structure
export interface FigmaFile {
  name?: string;
  document: DocumentNode;
  components?: { [key: string]: Component };
  componentSets?: { [key: string]: ComponentSet };
  schemaVersion?: number;
  styles?: { [key: string]: Style };
  mainFileKey?: string;
  branches?: Branch[];
  version?: string;
  role?: string;
  lastModified?: string;
  editorType?: string;
  thumbnailUrl?: string;
  linkAccess?: string;
}

export interface Component {
  key: string;
  name: string;
  description: string;
  componentSetId?: string;
  documentationLinks?: DocumentationLink[];
  remote?: boolean;
}

export interface ComponentSet {
  key: string;
  name: string;
  description: string;
  documentationLinks?: DocumentationLink[];
  remote?: boolean;
}

export interface DocumentationLink {
  uri: string;
}

export interface Style {
  key: string;
  name: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
  remote?: boolean;
  description?: string;
}

export interface Branch {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified?: string;
  link_access?: string;
}

// Component Tree types for the viewer
export interface ComponentTreeNode {
  id: string;
  name: string;
  type: NodeType;
  children?: ComponentTreeNode[];
  visible?: boolean;
  hasContent?: boolean;
}
