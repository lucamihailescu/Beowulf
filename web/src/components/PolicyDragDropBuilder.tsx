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
import { Card, Space, Typography, Tag, Input, Button, Divider, theme, Alert, Tooltip, Row, Col } from "antd";
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

interface DraggableItemProps {
  id: string;
  element: PolicyElement;
  isTemplate?: boolean;
  showDescription?: boolean;
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

// Draggable item component
function DraggableItem({ id, element, isTemplate, showDescription }: DraggableItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { element, isTemplate },
  });
  const { token } = theme.useToken();

  const getIcon = () => {
    switch (element.type) {
      case "effect":
        return element.value === "permit" ? (
          <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 18 }} />
        ) : (
          <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 18 }} />
        );
      case "principal":
        return <UserOutlined style={{ color: "#1890ff", fontSize: 18 }} />;
      case "action":
        return <ThunderboltOutlined style={{ color: "#722ed1", fontSize: 18 }} />;
      case "resource":
        return <FileOutlined style={{ color: "#fa8c16", fontSize: 18 }} />;
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
    if (element.type === "effect") {
      return elementDescriptions[element.value];
    }
    // Check for specific entity type descriptions (User, Group, etc.)
    if (element.entityType && elementDescriptions[element.entityType]) {
      return elementDescriptions[element.entityType];
    }
    return elementDescriptions[element.type];
  };

  const content = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        padding: "12px 16px",
        background: getColor(),
        border: `2px solid ${getBorderColor()}`,
        borderRadius: 10,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        userSelect: "none",
        minWidth: isTemplate ? 160 : 120,
        boxShadow: isDragging ? token.boxShadow : "0 1px 3px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.2s, transform 0.2s",
      }}
    >
      <div style={{ paddingTop: 2 }}>{getIcon()}</div>
      <div style={{ flex: 1 }}>
        <Typography.Text strong style={{ fontSize: 13, display: "block", marginBottom: 2 }}>
          {element.type === "effect" ? element.value.toUpperCase() : element.type.toUpperCase()}
        </Typography.Text>
        {element.entityType && (
          <Typography.Text style={{ fontSize: 11, color: token.colorTextSecondary }}>
            {element.entityType}::{element.entityId}
          </Typography.Text>
        )}
        {showDescription && (
          <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
            {getDescription()}
          </Typography.Text>
        )}
      </div>
    </div>
  );

  if (isTemplate) {
    return (
      <Tooltip title={getDescription()} placement="top">
        {content}
      </Tooltip>
    );
  }

  return content;
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
        minHeight: element ? "auto" : 120,
        padding: 16,
        border: `2px dashed ${isOver ? token.colorPrimary : token.colorBorder}`,
        borderRadius: 12,
        background: isOver ? token.colorPrimaryBg : getPlaceholderColor(),
        transition: "all 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Typography.Text strong style={{ color: getAccentColor() }}>
          {label}
        </Typography.Text>
        <Tooltip title={helpText}>
          <QuestionCircleOutlined style={{ color: token.colorTextSecondary, cursor: "help" }} />
        </Tooltip>
      </div>
      
      {element ? (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <DraggableItem id={`placed-${id}`} element={element} />
          {(element.type === "principal" || element.type === "action" || element.type === "resource") && (
            <div style={{ background: token.colorBgLayout, padding: 8, borderRadius: 6 }}>
              <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                Customize:
              </Typography.Text>
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
            </div>
          )}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={onRemove} block>
            Remove
          </Button>
        </Space>
      ) : (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            color: token.colorTextSecondary,
            border: `1px dashed ${token.colorBorder}`,
            borderRadius: 8,
            background: token.colorBgContainer,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Drag a <strong>{expectedType}</strong> element here
          </Typography.Text>
        </div>
      )}
    </div>
  );
}

// Main PolicyDragDropBuilder component
interface PolicyDragDropBuilderProps {
  onPolicyGenerated: (policyText: string) => void;
  entityTypes?: string[];
  entityIdsByType?: Map<string, string[]>;
}

export default function PolicyDragDropBuilder({
  onPolicyGenerated,
  entityTypes = ["User", "Group", "Document", "Folder", "Action"],
  entityIdsByType = new Map(),
}: PolicyDragDropBuilderProps) {
  const { token } = theme.useToken();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [effect, setEffect] = useState<PolicyElement | null>(null);
  const [principal, setPrincipal] = useState<PolicyElement | null>(null);
  const [action, setAction] = useState<PolicyElement | null>(null);
  const [resource, setResource] = useState<PolicyElement | null>(null);

  // Template elements for the palette
  const templateElements: PolicyElement[] = useMemo(() => {
    const elements: PolicyElement[] = [
      { id: "tpl-permit", type: "effect", value: "permit", description: "Allows the action" },
      { id: "tpl-forbid", type: "effect", value: "forbid", description: "Denies the action" },
      { id: "tpl-user", type: "principal", value: "User", entityType: "User", entityId: "alice" },
      { id: "tpl-group", type: "principal", value: "Group", entityType: "Group", entityId: "admins" },
      { id: "tpl-action", type: "action", value: "Action", entityType: "Action", entityId: "view" },
      { id: "tpl-resource", type: "resource", value: "Resource", entityType: "Document", entityId: "doc-1" },
    ];

    // Add entity-based templates if available
    entityTypes.forEach((type) => {
      if (!["User", "Group", "Document", "Folder", "Action"].includes(type)) {
        const ids = entityIdsByType.get(type) || [];
        if (ids.length > 0) {
          elements.push({
            id: `tpl-${type.toLowerCase()}`,
            type: type === "Action" ? "action" : "principal",
            value: type,
            entityType: type,
            entityId: ids[0],
          });
        }
      }
    });

    return elements;
  }, [entityTypes, entityIdsByType]);

  const activeElement = useMemo(() => {
    if (!activeId) return null;
    return templateElements.find((e) => e.id === activeId) || null;
  }, [activeId, templateElements]);

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
      id: `placed-${Date.now()}`,
    };

    // Place in the appropriate drop zone based on type matching
    switch (dropZoneId) {
      case "drop-effect":
        if (newElement.type === "effect") setEffect(newElement);
        break;
      case "drop-principal":
        if (newElement.type === "principal") setPrincipal(newElement);
        break;
      case "drop-action":
        if (newElement.type === "action") setAction(newElement);
        break;
      case "drop-resource":
        if (newElement.type === "resource") setResource(newElement);
        break;
    }
  }

  // Generate Cedar policy text
  const policyText = useMemo(() => {
    if (!effect || !principal || !action || !resource) return null;

    const escapeCedarString = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    return `${effect.value} (
  principal == ${principal.entityType}::"${escapeCedarString(principal.entityId || "")}",
  action == ${action.entityType}::"${escapeCedarString(action.entityId || "")}",
  resource == ${resource.entityType}::"${escapeCedarString(resource.entityId || "")}"
);`;
  }, [effect, principal, action, resource]);

  const isComplete = effect && principal && action && resource;
  const filledCount = [effect, principal, action, resource].filter(Boolean).length;

  function handleApply() {
    if (policyText) {
      onPolicyGenerated(policyText);
    }
  }

  function handleClear() {
    setEffect(null);
    setPrincipal(null);
    setAction(null);
    setResource(null);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <Space direction="vertical" size={24} style={{ width: "100%" }}>
        {/* Instructions */}
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message="How to use"
          description="Drag policy elements from the palette below into the drop zones. Each policy needs an Effect (permit/forbid), Principal (who), Action (what), and Resource (on what). Hover over elements for more details."
        />

        {/* Palette */}
        <div>
          <Typography.Title level={5} style={{ marginBottom: 12 }}>
            Policy Elements
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Drag these elements to build your policy. Hover for descriptions.
          </Typography.Paragraph>
          
          <Row gutter={[12, 12]}>
            {templateElements.map((element) => (
              <Col key={element.id} xs={12} sm={8} md={6} lg={4}>
                <DraggableItem id={element.id} element={element} isTemplate showDescription />
              </Col>
            ))}
          </Row>
        </div>

        <Divider style={{ margin: 0 }}>
          <Tag color={isComplete ? "success" : "default"}>
            {filledCount}/4 elements placed
          </Tag>
        </Divider>

        {/* Drop Zones */}
        <div>
          <Typography.Title level={5} style={{ marginBottom: 12 }}>
            Policy Canvas
          </Typography.Title>
          
          <Row gutter={[16, 16]}>
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
              <DropZone
                id="drop-principal"
                label="2. Principal"
                helpText="The entity (user, group, or service) making the request"
                element={principal}
                onRemove={() => setPrincipal(null)}
                onEdit={(type, id) =>
                  setPrincipal((prev) => (prev ? { ...prev, entityType: type, entityId: id } : null))
                }
                expectedType="principal"
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
        </div>

        {/* Preview */}
        <Card
          size="small"
          title="Generated Cedar Policy"
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
                Use This Policy
              </Button>
            </Space>
          }
        >
          {policyText ? (
            <pre
              style={{
                padding: 16,
                background: token.colorBgLayout,
                borderRadius: 8,
                margin: 0,
                fontSize: 13,
                fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
                overflow: "auto",
                border: `1px solid ${token.colorBorder}`,
              }}
            >
              {policyText}
            </pre>
          ) : (
            <div style={{ padding: 24, textAlign: "center" }}>
              <Typography.Text type="secondary">
                Complete all 4 drop zones to generate a policy
              </Typography.Text>
            </div>
          )}
        </Card>
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
