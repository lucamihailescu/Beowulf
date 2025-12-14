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
import { Card, Space, Typography, Tag, Input, Button, Divider, theme, Alert, Tooltip, Row, Col, Switch } from "antd";
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

// Draggable item component
function DraggableItem({ id, element, isTemplate, showDescription, compact }: DraggableItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { element, isTemplate },
  });
  const { token } = theme.useToken();

  const getIcon = () => {
    switch (element.type) {
      case "effect":
        return element.value === "permit" ? (
          <CheckCircleOutlined style={{ color: "#52c41a", fontSize: compact ? 14 : 18 }} />
        ) : (
          <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: compact ? 14 : 18 }} />
        );
      case "principal":
        return element.entityType === "Group" ? (
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
    if (element.type === "effect") {
      return elementDescriptions[element.value];
    }
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
        padding: compact ? "6px 10px" : "12px 16px",
        background: getColor(),
        border: `2px solid ${getBorderColor()}`,
        borderRadius: compact ? 6 : 10,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        alignItems: "flex-start",
        gap: compact ? 8 : 12,
        userSelect: "none",
        minWidth: isTemplate ? 160 : (compact ? 100 : 120),
        boxShadow: isDragging ? token.boxShadow : "0 1px 3px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.2s, transform 0.2s",
      }}
    >
      <div style={{ paddingTop: compact ? 0 : 2 }}>{getIcon()}</div>
      <div style={{ flex: 1 }}>
        <Typography.Text strong style={{ fontSize: compact ? 11 : 13, display: "block", marginBottom: compact ? 0 : 2 }}>
          {element.type === "effect" ? element.value.toUpperCase() : element.entityType || element.type.toUpperCase()}
        </Typography.Text>
        {element.entityType && !compact && (
          <Typography.Text style={{ fontSize: 11, color: token.colorTextSecondary }}>
            {element.entityType}::{element.entityId}
          </Typography.Text>
        )}
        {element.entityType && compact && (
          <Typography.Text style={{ fontSize: 10, color: token.colorTextSecondary }}>
            ::{element.entityId}
          </Typography.Text>
        )}
        {showDescription && !compact && (
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
      {principal.entityType === "Group" ? (
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
  const [principals, setPrincipals] = useState<PolicyElement[]>([]);
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
      const operator = principal.entityType === "Group" ? "in" : "==";
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
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Policy Elements <Typography.Text type="secondary" style={{ fontWeight: "normal" }}>(drag to canvas)</Typography.Text>
          </Typography.Text>
          
          <Row gutter={[8, 8]}>
            {templateElements.map((element) => (
              <Col key={element.id}>
                <DraggableItem id={element.id} element={element} isTemplate showDescription />
              </Col>
            ))}
          </Row>
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
