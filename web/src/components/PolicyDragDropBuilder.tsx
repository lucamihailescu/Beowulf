import React, { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Card, Space, Typography, Tag, Input, Button, Divider, theme, Alert, Tooltip, Row, Col, Collapse } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserOutlined,
  ThunderboltOutlined,
  FileOutlined,
  DeleteOutlined,
  CopyOutlined,
  QuestionCircleOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  TeamOutlined,
} from "@ant-design/icons";

// Types for policy elements
type PolicyElementType = "effect" | "principal" | "action" | "resource";

interface PolicyElement {
  id: string;
  type: PolicyElementType;
  value: string;
  entityType?: string;
  entityId?: string;
  description?: string;
}

type ActionRefOption = {
  actionType: string;
  actionId: string;
  principalTypes?: string[];
  resourceTypes?: string[];
  contextAttributes?: string[];
};

interface DraggableItemProps {
  id: string;
  element: PolicyElement;
  isTemplate?: boolean;
  showDescription?: boolean;
  compact?: boolean;
}

// Element descriptions for help
const elementDescriptions: Record<string, string> = {
  permit: "Allows the action to be performed",
  forbid: "Denies the action from being performed",
  principal: "The entity making the request (e.g., a user or service)",
  User: "A specific user making the request",
  Group: "A group of users (use 'in' for membership checks)",
  action: "The operation being requested (e.g., view, edit, delete)",
  resource: "The target of the action (e.g., a document or folder)",
};

function isGroupType(type?: string): boolean {
  if (!type) return false;
  return type === "Group" || type.endsWith("::Group");
}

const paletteGroupOrder: PolicyElementType[] = ["effect", "principal", "action", "resource"];
const paletteGroupLabels: Record<PolicyElementType, string> = {
  effect: "Effects",
  principal: "Principals",
  action: "Actions",
  resource: "Resources",
};

function isPaletteGroupKey(value: string): value is PolicyElementType {
  return value === "effect" || value === "principal" || value === "action" || value === "resource";
}

function stripNamespace(value?: string): string {
  if (!value) return "";
  const parts = value.split("::");
  return parts[parts.length - 1] || value;
}

function humanizeIdentifier(value?: string): string {
  if (!value) return "";
  const source = stripNamespace(value);
  const withSpaces = source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withSpaces) return source;
  return withSpaces
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatTypeList(types?: string[]): string {
  if (!types || types.length === 0) return "";
  const normalized = types.map((t) => stripNamespace(t));
  if (normalized.length <= 2) return normalized.join(", ");
  return `${normalized.slice(0, 2).join(", ")} +${normalized.length - 2}`;
}

// Draggable item component
function DraggableItem({ id, element, isTemplate, showDescription, compact }: DraggableItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { element, isTemplate },
  });
  const { token } = theme.useToken();
  const isActionOrResource = element.type === "action" || element.type === "resource";
  const useFocusedTemplateLayout = Boolean(isTemplate && isActionOrResource && !compact);

  const getIcon = () => {
    switch (element.type) {
      case "effect":
        return element.value === "permit" ? (
          <CheckCircleOutlined style={{ color: "#52c41a", fontSize: compact ? 14 : 18 }} />
        ) : (
          <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: compact ? 14 : 18 }} />
        );
      case "principal":
        return isGroupType(element.entityType) ? (
          <TeamOutlined style={{ color: "#1890ff", fontSize: compact ? 14 : 18 }} />
        ) : (
          <UserOutlined style={{ color: "#1890ff", fontSize: compact ? 14 : 18 }} />
        );
      case "action":
        return <ThunderboltOutlined style={{ color: "#722ed1", fontSize: compact ? 14 : 18 }} />;
      case "resource":
        return <FileOutlined style={{ color: "#fa8c16", fontSize: compact ? 14 : 18 }} />;
    }
  };

  const getColor = () => {
    switch (element.type) {
      case "effect":
        return element.value === "permit" ? "#f6ffed" : "#fff2f0";
      case "principal":
        return "#e6f7ff";
      case "action":
        return "#f9f0ff";
      case "resource":
        return "#fff7e6";
    }
  };

  const getBorderColor = () => {
    switch (element.type) {
      case "effect":
        return element.value === "permit" ? "#b7eb8f" : "#ffccc7";
      case "principal":
        return "#91d5ff";
      case "action":
        return "#d3adf7";
      case "resource":
        return "#ffd591";
    }
  };

  const getDescription = () => {
    if (element.description) return element.description;
    if (element.type === "effect") {
      return elementDescriptions[element.value];
    }
    if (element.entityType && elementDescriptions[element.entityType]) {
      return elementDescriptions[element.entityType];
    }
    return elementDescriptions[element.type];
  };

  const getDisplayTitle = () => {
    if (element.type === "effect") return element.value.toUpperCase();
    if (isActionOrResource) {
      const focusedLabel = humanizeIdentifier(element.entityId || element.value);
      return focusedLabel || humanizeIdentifier(element.entityType) || element.type.toUpperCase();
    }
    return humanizeIdentifier(element.entityType || element.type) || element.type.toUpperCase();
  };

  const getSecondaryText = () => {
    if (!element.entityType) return "";
    if (isActionOrResource) {
      return element.entityId ? `${element.entityType}::${element.entityId}` : element.entityType;
    }
    if (compact) return `::${element.entityId || ""}`;
    return element.entityId ? `${element.entityType}::${element.entityId}` : element.entityType;
  };

  const descriptionText = getDescription();
  const showInlineDescription = showDescription && !compact && (!isActionOrResource || Boolean(element.description));

  const content = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        padding: compact ? "6px 10px" : useFocusedTemplateLayout ? "8px 12px" : "12px 16px",
        background: getColor(),
        border: `2px solid ${getBorderColor()}`,
        borderRadius: compact ? 6 : 8,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        alignItems: "flex-start",
        gap: compact ? 8 : useFocusedTemplateLayout ? 10 : 12,
        userSelect: "none",
        minWidth: isTemplate ? (useFocusedTemplateLayout ? 130 : 160) : (compact ? 100 : 120),
        maxWidth: isTemplate ? 260 : undefined,
        boxShadow: isDragging ? token.boxShadow : "0 1px 3px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.2s, transform 0.2s",
      }}
    >
      <div style={{ paddingTop: compact ? 0 : 2 }}>{getIcon()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text
          strong
          style={{
            fontSize: compact ? 11 : useFocusedTemplateLayout ? 12 : 13,
            display: "block",
            marginBottom: compact ? 0 : 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={getDisplayTitle()}
        >
          {getDisplayTitle()}
        </Typography.Text>
        {element.entityType && (
          <Typography.Text
            style={{
              fontSize: compact ? 10 : 11,
              color: token.colorTextSecondary,
              display: "block",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={getSecondaryText()}
          >
            {getSecondaryText()}
          </Typography.Text>
        )}
        {showInlineDescription && (
          <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
            {descriptionText}
          </Typography.Text>
        )}
      </div>
    </div>
  );

  if (isTemplate) {
    return (
      <Tooltip title={descriptionText} placement="top">
        {content}
      </Tooltip>
    );
  }

  return content;
}

// Principal item for the multi-principal list
interface PrincipalItemProps {
  principal: PolicyElement;
  onEdit: (entityType: string, entityId: string) => void;
  onRemove: () => void;
}

function PrincipalItem({ principal, onEdit, onRemove }: PrincipalItemProps) {
  const { token } = theme.useToken();
  
  return (
    <div style={{ 
      display: "flex", 
      alignItems: "center", 
      gap: 8, 
      padding: 8, 
      background: token.colorBgLayout,
      borderRadius: 6,
      border: `1px solid ${token.colorBorder}`,
    }}>
      {isGroupType(principal.entityType) ? (
        <TeamOutlined style={{ color: "#1890ff" }} />
      ) : (
        <UserOutlined style={{ color: "#1890ff" }} />
      )}
      <Input
        size="small"
        placeholder="Type"
        value={principal.entityType}
        onChange={(e) => onEdit(e.target.value, principal.entityId || "")}
        style={{ width: 80 }}
      />
      <Input
        size="small"
        placeholder="ID"
        value={principal.entityId}
        onChange={(e) => onEdit(principal.entityType || "", e.target.value)}
        style={{ flex: 1 }}
      />
      <Button size="small" danger icon={<DeleteOutlined />} onClick={onRemove} />
    </div>
  );
}

// Drop zone component
interface DropZoneProps {
  id: string;
  label: string;
  helpText: string;
  element: PolicyElement | null;
  onRemove: () => void;
  onEdit: (entityType: string, entityId: string) => void;
  expectedType: PolicyElementType;
}

function DropZone({ id, label, helpText, element, onRemove, onEdit, expectedType }: DropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const { token } = theme.useToken();

  const getPlaceholderColor = () => {
    switch (expectedType) {
      case "effect":
        return "#fafafa";
      case "principal":
        return "#f0f9ff";
      case "action":
        return "#faf5ff";
      case "resource":
        return "#fffbf0";
    }
  };

  const getAccentColor = () => {
    switch (expectedType) {
      case "effect":
        return "#52c41a";
      case "principal":
        return "#1890ff";
      case "action":
        return "#722ed1";
      case "resource":
        return "#fa8c16";
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: element ? "auto" : 100,
        padding: 12,
        border: `2px dashed ${isOver ? token.colorPrimary : token.colorBorder}`,
        borderRadius: 12,
        background: isOver ? token.colorPrimaryBg : getPlaceholderColor(),
        transition: "all 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Typography.Text strong style={{ color: getAccentColor(), fontSize: 12 }}>
          {label}
        </Typography.Text>
        <Tooltip title={helpText}>
          <QuestionCircleOutlined style={{ color: token.colorTextSecondary, cursor: "help", fontSize: 12 }} />
        </Tooltip>
      </div>
      
      {element ? (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <DraggableItem id={`placed-${id}`} element={element} compact />
          {(element.type === "action" || element.type === "resource") && (
            <Space.Compact style={{ width: "100%" }}>
              <Input
                size="small"
                placeholder="Type"
                value={element.entityType}
                onChange={(e) => onEdit(e.target.value, element.entityId || "")}
                style={{ width: "40%" }}
              />
              <Input
                size="small"
                placeholder="ID"
                value={element.entityId}
                onChange={(e) => onEdit(element.entityType || "", e.target.value)}
                style={{ width: "60%" }}
              />
            </Space.Compact>
          )}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={onRemove} block>
            Remove
          </Button>
        </Space>
      ) : (
        <div
          style={{
            padding: 16,
            textAlign: "center",
            color: token.colorTextSecondary,
            border: `1px dashed ${token.colorBorder}`,
            borderRadius: 8,
            background: token.colorBgContainer,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Drag here
          </Typography.Text>
        </div>
      )}
    </div>
  );
}

// Multi-principal drop zone
interface MultiPrincipalDropZoneProps {
  principals: PolicyElement[];
  onAdd: (element: PolicyElement) => void;
  onEdit: (index: number, entityType: string, entityId: string) => void;
  onRemove: (index: number) => void;
}

function MultiPrincipalDropZone({ principals, onAdd, onEdit, onRemove }: MultiPrincipalDropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({ id: "drop-principal" });
  const { token } = theme.useToken();

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 100,
        padding: 12,
        border: `2px dashed ${isOver ? token.colorPrimary : token.colorBorder}`,
        borderRadius: 12,
        background: isOver ? token.colorPrimaryBg : "#f0f9ff",
        transition: "all 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Typography.Text strong style={{ color: "#1890ff", fontSize: 12 }}>
            2. Principals (Who?)
          </Typography.Text>
          <Tooltip title="Add multiple principals to create separate policies for each. Cedar creates one policy per principal.">
            <QuestionCircleOutlined style={{ color: token.colorTextSecondary, cursor: "help", fontSize: 12 }} />
          </Tooltip>
        </div>
        {principals.length > 0 && (
          <Tag color="blue">{principals.length} {principals.length === 1 ? 'principal' : 'principals'}</Tag>
        )}
      </div>

      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        {principals.map((principal, index) => (
          <PrincipalItem
            key={principal.id}
            principal={principal}
            onEdit={(type, id) => onEdit(index, type, id)}
            onRemove={() => onRemove(index)}
          />
        ))}
        
        {principals.length === 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              color: token.colorTextSecondary,
              border: `1px dashed ${token.colorBorder}`,
              borderRadius: 8,
              background: token.colorBgContainer,
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Drag User or Group here
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              Add multiple to create batch policies
            </Typography.Text>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              Drag more principals to add them
            </Typography.Text>
          </div>
        )}
      </Space>
    </div>
  );
}

// Main PolicyDragDropBuilder component
interface PolicyDragDropBuilderProps {
  onPolicyGenerated: (policyText: string) => void;
  entityTypes?: string[];
  entityIdsByType?: Map<string, string[]>;
  actionRefs?: ActionRefOption[];
}

export default function PolicyDragDropBuilder({
  onPolicyGenerated,
  entityTypes = ["User", "Group", "Document", "Folder", "Action"],
  entityIdsByType = new Map(),
  actionRefs = [],
}: PolicyDragDropBuilderProps) {
  const { token } = theme.useToken();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [effect, setEffect] = useState<PolicyElement | null>(null);
  const [principals, setPrincipals] = useState<PolicyElement[]>([]);
  const [action, setAction] = useState<PolicyElement | null>(null);
  const [resource, setResource] = useState<PolicyElement | null>(null);
  const [paletteFilter, setPaletteFilter] = useState("");
  const [openPaletteGroups, setOpenPaletteGroups] = useState<PolicyElementType[]>(["effect", "principal"]);

  // Template elements for the palette
  const templateElements: PolicyElement[] = useMemo(() => {
    const firstAction = actionRefs[0] ?? { actionType: "Action", actionId: "view" };
    const defaultResourceType =
      entityTypes.find((t) => !t.endsWith("::User") && !t.endsWith("::Group") && t !== "User" && t !== "Group" && !t.endsWith("::Action") && t !== "Action") ||
      "Document";

    const elements: PolicyElement[] = [
      { id: "tpl-permit", type: "effect", value: "permit", description: "Allows the action" },
      { id: "tpl-forbid", type: "effect", value: "forbid", description: "Denies the action" },
      { id: "tpl-user", type: "principal", value: "User", entityType: "User", entityId: "alice" },
      { id: "tpl-group", type: "principal", value: "Group", entityType: "Group", entityId: "admins" },
      { id: "tpl-action", type: "action", value: firstAction.actionId, entityType: firstAction.actionType, entityId: firstAction.actionId },
      { id: "tpl-resource", type: "resource", value: "Resource", entityType: defaultResourceType, entityId: "resource-1" },
    ];

    // Add schema-derived action templates when available.
    actionRefs.forEach((ref) => {
      const principalHint = formatTypeList(ref.principalTypes);
      const resourceHint = formatTypeList(ref.resourceTypes);
      const contextCount = ref.contextAttributes?.length ?? 0;
      const descriptionParts = [
        principalHint ? `Principal: ${principalHint}` : "",
        resourceHint ? `Resource: ${resourceHint}` : "",
        contextCount > 0 ? `Context attrs: ${contextCount}` : "",
      ].filter(Boolean);

      elements.push({
        id: `tpl-action-${ref.actionType}-${ref.actionId}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
        type: "action",
        value: ref.actionId,
        entityType: ref.actionType,
        entityId: ref.actionId,
        description: descriptionParts.length > 0 ? descriptionParts.join(" | ") : undefined,
      });
    });

    const isPrincipalType = (type: string) => type === "User" || type === "Group" || type.endsWith("::User") || type.endsWith("::Group");
    const isActionType = (type: string) => type === "Action" || type.endsWith("::Action");

    // Add schema/entity type templates even without pre-seeded entities.
    // This ensures newly introduced resource types (e.g., EmailRecipient/HttpEndpoint) show up immediately.
    entityTypes.forEach((type) => {
      if (!["User", "Group", "Document", "Folder", "Action"].includes(type)) {
        const ids = entityIdsByType.get(type) || [];
        const elementType: PolicyElementType = isActionType(type)
          ? "action"
          : isPrincipalType(type)
            ? "principal"
            : "resource";
        const fallbackID =
          ids[0] ||
          (elementType === "principal"
            ? "example-principal"
            : elementType === "action"
              ? "example.action"
              : "example-resource");

        elements.push({
          id: `tpl-${type.toLowerCase()}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
          type: elementType,
          value: type,
          entityType: type,
          entityId: fallbackID,
        });
      }
    });

    // Deduplicate templates by type + entity ref.
    const seen = new Set<string>();
    return elements.filter((el) => {
      const key = `${el.type}|${el.entityType || ""}|${el.entityId || ""}|${el.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [entityTypes, entityIdsByType, actionRefs]);

  const activeElement = useMemo(() => {
    if (!activeId) return null;
    return templateElements.find((e) => e.id === activeId) || null;
  }, [activeId, templateElements]);

  const filteredTemplateElements = useMemo(() => {
    const filterValue = paletteFilter.trim().toLowerCase();
    if (!filterValue) return templateElements;

    return templateElements.filter((element) => {
      const searchTokens = [
        element.type,
        element.value,
        element.entityType,
        element.entityId,
        elementDescriptions[element.value],
        element.entityType ? elementDescriptions[element.entityType] : "",
        elementDescriptions[element.type],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchTokens.includes(filterValue);
    });
  }, [templateElements, paletteFilter]);

  const groupedTemplateElements = useMemo(() => {
    const grouped: Record<PolicyElementType, PolicyElement[]> = {
      effect: [],
      principal: [],
      action: [],
      resource: [],
    };

    filteredTemplateElements.forEach((element) => {
      grouped[element.type].push(element);
    });

    return grouped;
  }, [filteredTemplateElements]);

  function handlePaletteGroupChange(keys: string | string[]) {
    const normalized = (Array.isArray(keys) ? keys : [keys]).filter(isPaletteGroupKey);
    setOpenPaletteGroups(normalized);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const draggedElement = active.data.current?.element as PolicyElement;
    if (!draggedElement) return;

    const dropZoneId = over.id as string;

    // Clone the element with a new ID
    const newElement: PolicyElement = {
      ...draggedElement,
      id: `placed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    // Place in the appropriate drop zone based on type matching
    switch (dropZoneId) {
      case "drop-effect":
        if (newElement.type === "effect") setEffect(newElement);
        break;
      case "drop-principal":
        if (newElement.type === "principal") {
          setPrincipals((prev) => [...prev, newElement]);
        }
        break;
      case "drop-action":
        if (newElement.type === "action") setAction(newElement);
        break;
      case "drop-resource":
        if (newElement.type === "resource") setResource(newElement);
        break;
    }
  }

  // Generate Cedar policy text(s)
  const policyTexts = useMemo(() => {
    if (!effect || principals.length === 0 || !action || !resource) return [];

    const escapeCedarString = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    return principals.map((principal) => {
      const operator = isGroupType(principal.entityType) ? "in" : "==";
      return `${effect.value} (
  principal ${operator} ${principal.entityType}::"${escapeCedarString(principal.entityId || "")}",
  action == ${action.entityType}::"${escapeCedarString(action.entityId || "")}",
  resource == ${resource.entityType}::"${escapeCedarString(resource.entityId || "")}"
);`;
    });
  }, [effect, principals, action, resource]);

  const combinedPolicyText = policyTexts.join("\n\n");
  const isComplete = effect && principals.length > 0 && action && resource;
  const filledCount = [effect, principals.length > 0, action, resource].filter(Boolean).length;

  function handleApply() {
    if (combinedPolicyText) {
      onPolicyGenerated(combinedPolicyText);
    }
  }

  function handleClear() {
    setEffect(null);
    setPrincipals([]);
    setAction(null);
    setResource(null);
  }

  function handleEditPrincipal(index: number, entityType: string, entityId: string) {
    setPrincipals((prev) => 
      prev.map((p, i) => i === index ? { ...p, entityType, entityId } : p)
    );
  }

  function handleRemovePrincipal(index: number) {
    setPrincipals((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        {/* Instructions */}
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message="How to use the Visual Policy Builder"
          description={
            <span>
              Drag elements into the drop zones below. <strong>Tip:</strong> Add multiple principals (users/groups) 
              to create separate policies for each — this is the Cedar way to allow multiple entities access.
            </span>
          }
        />

        {/* Palette */}
        <div>
          <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }} align="center">
            <Typography.Text strong>
              Policy Elements <Typography.Text type="secondary" style={{ fontWeight: "normal" }}>(drag to canvas)</Typography.Text>
            </Typography.Text>
            <Space size={4}>
              <Button type="text" size="small" onClick={() => setOpenPaletteGroups(paletteGroupOrder)}>
                Expand all
              </Button>
              <Button type="text" size="small" onClick={() => setOpenPaletteGroups([])}>
                Collapse all
              </Button>
            </Space>
          </Space>

          <Input
            size="small"
            allowClear
            placeholder="Filter by type, id, or description"
            value={paletteFilter}
            onChange={(e) => setPaletteFilter(e.target.value)}
            style={{ marginBottom: 10, maxWidth: 420 }}
          />

          {filteredTemplateElements.length === 0 ? (
            <div
              style={{
                padding: 16,
                border: `1px dashed ${token.colorBorder}`,
                borderRadius: 8,
                background: token.colorBgContainer,
              }}
            >
              <Typography.Text type="secondary">No policy elements match the current filter.</Typography.Text>
            </div>
          ) : (
            <Collapse
              size="small"
              activeKey={openPaletteGroups}
              onChange={handlePaletteGroupChange}
              items={paletteGroupOrder.map((groupKey) => ({
                key: groupKey,
                label: (
                  <Space size={8}>
                    <Typography.Text strong>{paletteGroupLabels[groupKey]}</Typography.Text>
                    <Tag>{groupedTemplateElements[groupKey].length}</Tag>
                  </Space>
                ),
                children:
                  groupedTemplateElements[groupKey].length > 0 ? (
                    <Row gutter={[8, 8]}>
                      {groupedTemplateElements[groupKey].map((element) => (
                        <Col key={element.id}>
                          <DraggableItem id={element.id} element={element} isTemplate showDescription />
                        </Col>
                      ))}
                    </Row>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      No matching {paletteGroupLabels[groupKey].toLowerCase()}.
                    </Typography.Text>
                  ),
              }))}
            />
          )}
        </div>

        <Divider style={{ margin: 0 }}>
          <Space>
            <Tag color={isComplete ? "success" : "default"}>
              {filledCount}/4 zones filled
            </Tag>
            {principals.length > 1 && (
              <Tag color="blue">
                {principals.length} policies will be created
              </Tag>
            )}
          </Space>
        </Divider>

        {/* Drop Zones */}
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} md={6}>
            <DropZone
              id="drop-effect"
              label="1. Effect"
              helpText="Choose whether this policy permits or forbids the action"
              element={effect}
              onRemove={() => setEffect(null)}
              onEdit={() => {}}
              expectedType="effect"
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <MultiPrincipalDropZone
              principals={principals}
              onAdd={(element) => setPrincipals((prev) => [...prev, element])}
              onEdit={handleEditPrincipal}
              onRemove={handleRemovePrincipal}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <DropZone
              id="drop-action"
              label="3. Action"
              helpText="The operation being requested (e.g., view, edit, delete)"
              element={action}
              onRemove={() => setAction(null)}
              onEdit={(type, id) =>
                setAction((prev) => (prev ? { ...prev, entityType: type, entityId: id } : null))
              }
              expectedType="action"
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <DropZone
              id="drop-resource"
              label="4. Resource"
              helpText="The target of the action (e.g., a document or folder)"
              element={resource}
              onRemove={() => setResource(null)}
              onEdit={(type, id) =>
                setResource((prev) => (prev ? { ...prev, entityType: type, entityId: id } : null))
              }
              expectedType="resource"
            />
          </Col>
        </Row>

        {/* Preview */}
        <Card
          size="small"
          title={
            <Space>
              <span>Generated Cedar {policyTexts.length > 1 ? "Policies" : "Policy"}</span>
              {policyTexts.length > 1 && (
                <Tag color="blue">{policyTexts.length} policies</Tag>
              )}
            </Space>
          }
          extra={
            <Space>
              <Button size="small" onClick={handleClear} disabled={filledCount === 0}>
                Clear All
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<CopyOutlined />}
                onClick={handleApply}
                disabled={!isComplete}
              >
                Use {policyTexts.length > 1 ? "These Policies" : "This Policy"}
              </Button>
            </Space>
          }
        >
          {policyTexts.length > 0 ? (
            <pre
              style={{
                padding: 16,
                background: token.colorBgLayout,
                borderRadius: 8,
                margin: 0,
                fontSize: 12,
                fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
                overflow: "auto",
                maxHeight: 300,
                border: `1px solid ${token.colorBorder}`,
              }}
            >
              {combinedPolicyText}
            </pre>
          ) : (
            <div style={{ padding: 24, textAlign: "center" }}>
              <Typography.Text type="secondary">
                Fill all drop zones to generate policies. Add multiple principals to create batch policies.
              </Typography.Text>
            </div>
          )}
        </Card>

        {/* Multi-policy explanation */}
        {principals.length > 1 && (
          <Alert
            type="success"
            showIcon
            message={`Creating ${principals.length} separate policies`}
            description="Cedar evaluates all policies — if ANY permit policy matches, the request is allowed. This is the recommended way to grant access to multiple users or groups."
          />
        )}
      </Space>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeElement ? (
          <div style={{ opacity: 0.95, transform: "scale(1.05)" }}>
            <DraggableItem id="overlay" element={activeElement} showDescription />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
