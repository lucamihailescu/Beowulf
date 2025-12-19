import { useState, useEffect } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Steps,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  InfoCircleOutlined,
  UserOutlined,
  TeamOutlined,
  FileOutlined,
  LockOutlined,
  UnlockOutlined,
  CloudOutlined,
  CloudServerOutlined,
} from "@ant-design/icons";
import { EntraPicker, EntraSelection } from "./EntraPicker";
import { ADPicker, ADSelection } from "./ADPicker";
import { api, IdentityProvider } from "../api";

type PolicyTemplate = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: "rbac" | "abac" | "ownership" | "hierarchy";
  variables: TemplateVariable[];
  generatePolicy: (values: Record<string, string>) => string;
};

type TemplateVariable = {
  key: string;
  label: string;
  description: string;
  // identity-* types will use either EntraPicker or ADPicker based on the active identity provider
  type: "text" | "select" | "multi-select" | "entra-user" | "entra-group" | "entra-both" | "identity-user" | "identity-group" | "identity-both";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};

type PolicyTemplateWizardProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string, policyText: string, activate: boolean) => Promise<void>;
  saving: boolean;
  approvalRequired?: boolean;
  entityTypes: string[];
  actions: string[];
};

const POLICY_TEMPLATES: PolicyTemplate[] = [
  // ========== USER-BASED TEMPLATES ==========
  {
    id: "user-full-access",
    name: "User Full Access",
    description: "Grant a specific user full access to all resources",
    icon: <UserOutlined />,
    category: "rbac",
    variables: [
      {
        key: "userId",
        label: "User",
        description: "Select a user from Entra ID or enter a user ID manually",
        type: "entra-user",
        placeholder: "john.doe@company.com",
        required: true,
      },
    ],
    generatePolicy: (values) => `// User Full Access Policy
// User ${values.userId} has full access to all resources

permit (
  principal == User::"${values.userId}",
  action,
  resource
);`,
  },
  {
    id: "user-resource-access",
    name: "User Resource Access",
    description: "Grant a user specific actions on specific resource types",
    icon: <UserOutlined />,
    category: "rbac",
    variables: [
      {
        key: "userId",
        label: "User",
        description: "Select a user from Entra ID or enter a user ID manually",
        type: "entra-user",
        placeholder: "john.doe@company.com",
        required: true,
      },
      {
        key: "actions",
        label: "Actions (comma-separated)",
        description: "Actions the user can perform (e.g., view, edit, delete)",
        type: "text",
        placeholder: "view, edit",
        required: true,
      },
      {
        key: "resourceType",
        label: "Resource Type",
        description: "The type of resource (leave empty for all types)",
        type: "text",
        placeholder: "Document",
        required: false,
      },
      {
        key: "resourceId",
        label: "Resource ID (optional)",
        description: "Specific resource ID (leave empty for all resources of this type)",
        type: "text",
        placeholder: "doc-123",
        required: false,
      },
    ],
    generatePolicy: (values) => {
      const actions = (values.actions || "").split(",").map((a) => a.trim()).filter(Boolean);
      const hasResourceType = values.resourceType?.trim();
      const hasResourceId = values.resourceId?.trim();
      const userId = values.userId || "<user>";
      
      let resourceClause = "resource";
      if (hasResourceId && hasResourceType) {
        resourceClause = `resource == ${values.resourceType}::"${values.resourceId}"`;
      } else if (hasResourceType) {
        resourceClause = `resource is ${values.resourceType}`;
      }
      
      if (actions.length === 0) {
        return `// User Resource Access Policy
// Configure actions to generate the policy

permit (
  principal == User::"${userId}",
  action == Action::"<action>",
  ${resourceClause}
);`;
      }
      
      if (actions.length === 1) {
        return `// User Resource Access Policy
// User ${userId} can ${actions[0]} ${hasResourceType || "all"} resources

permit (
  principal == User::"${userId}",
  action == Action::"${actions[0]}",
  ${resourceClause}
);`;
      }
      
      return `// User Resource Access Policy
// User ${userId} can perform specified actions on ${hasResourceType || "all"} resources

${actions.map((action) => `permit (
  principal == User::"${userId}",
  action == Action::"${action}",
  ${resourceClause}
);`).join("\n\n")}`;
    },
  },
  // ========== GROUP-BASED TEMPLATES ==========
  {
    id: "group-full-access",
    name: "Group Full Access",
    description: "Grant full access to all resources for group members",
    icon: <LockOutlined />,
    category: "rbac",
    variables: [
      {
        key: "groupId",
        label: "Group",
        description: "Select a group from Entra ID or enter a group ID manually",
        type: "entra-group",
        placeholder: "admins",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Group Full Access Policy
// Members of the ${values.groupId} group have full access to all resources

permit (
  principal in Group::"${values.groupId}",
  action,
  resource
);`,
  },
  {
    id: "group-resource-access",
    name: "Group Resource Access",
    description: "Grant group members specific actions on specific resources",
    icon: <TeamOutlined />,
    category: "rbac",
    variables: [
      {
        key: "groupId",
        label: "Group",
        description: "Select a group from Entra ID or enter a group ID manually",
        type: "entra-group",
        placeholder: "engineering",
        required: true,
      },
      {
        key: "actions",
        label: "Actions (comma-separated)",
        description: "Actions group members can perform (e.g., view, edit, delete)",
        type: "text",
        placeholder: "view, edit",
        required: true,
      },
      {
        key: "resourceType",
        label: "Resource Type",
        description: "The type of resource (leave empty for all types)",
        type: "text",
        placeholder: "Document",
        required: false,
      },
      {
        key: "resourceId",
        label: "Resource ID (optional)",
        description: "Specific resource ID (leave empty for all resources of this type)",
        type: "text",
        placeholder: "doc-123",
        required: false,
      },
    ],
    generatePolicy: (values) => {
      const actions = (values.actions || "").split(",").map((a) => a.trim()).filter(Boolean);
      const hasResourceType = values.resourceType?.trim();
      const hasResourceId = values.resourceId?.trim();
      const groupId = values.groupId || "<group>";
      
      let resourceClause = "resource";
      if (hasResourceId && hasResourceType) {
        resourceClause = `resource == ${values.resourceType}::"${values.resourceId}"`;
      } else if (hasResourceType) {
        resourceClause = `resource is ${values.resourceType}`;
      }
      
      if (actions.length === 0) {
        return `// Group Resource Access Policy
// Configure actions to generate the policy

permit (
  principal in Group::"${groupId}",
  action == Action::"<action>",
  ${resourceClause}
);`;
      }
      
      if (actions.length === 1) {
        return `// Group Resource Access Policy
// Members of ${groupId} can ${actions[0]} ${hasResourceType || "all"} resources

permit (
  principal in Group::"${groupId}",
  action == Action::"${actions[0]}",
  ${resourceClause}
);`;
      }
      
      return `// Group Resource Access Policy
// Members of ${groupId} can perform specified actions on ${hasResourceType || "all"} resources

${actions.map((action) => `permit (
  principal in Group::"${groupId}",
  action == Action::"${action}",
  ${resourceClause}
);`).join("\n\n")}`;
    },
  },
  // ========== USER OR GROUP TEMPLATES ==========
  {
    id: "principal-resource-access",
    name: "Principal Resource Access",
    description: "Grant a user OR group specific actions on resources (flexible)",
    icon: <CloudOutlined />,
    category: "rbac",
    variables: [
      {
        key: "principalId",
        label: "User or Group",
        description: "Select a user or group from Entra ID",
        type: "entra-both",
        placeholder: "Select user or group...",
        required: true,
      },
      {
        key: "principalType",
        label: "Principal Type",
        description: "Is this a User or Group?",
        type: "select",
        options: [
          { value: "User", label: "User" },
          { value: "Group", label: "Group" },
        ],
        required: true,
      },
      {
        key: "actions",
        label: "Actions (comma-separated)",
        description: "Actions to allow (e.g., view, edit, delete, create)",
        type: "text",
        placeholder: "view, edit, delete",
        required: true,
      },
      {
        key: "resourceType",
        label: "Resource Type",
        description: "The type of resource (leave empty for all types)",
        type: "text",
        placeholder: "Document",
        required: false,
      },
      {
        key: "resourceId",
        label: "Resource ID (optional)",
        description: "Specific resource ID (leave empty for all resources)",
        type: "text",
        placeholder: "doc-123",
        required: false,
      },
    ],
    generatePolicy: (values) => {
      const actions = (values.actions || "").split(",").map((a) => a.trim()).filter(Boolean);
      const hasResourceType = values.resourceType?.trim();
      const hasResourceId = values.resourceId?.trim();
      const isGroup = values.principalType === "Group";
      const principalId = values.principalId || "<principal>";
      const principalType = values.principalType || "User";
      
      let resourceClause = "resource";
      if (hasResourceId && hasResourceType) {
        resourceClause = `resource == ${values.resourceType}::"${values.resourceId}"`;
      } else if (hasResourceType) {
        resourceClause = `resource is ${values.resourceType}`;
      }
      
      const principalClause = isGroup 
        ? `principal in Group::"${principalId}"`
        : `principal == User::"${principalId}"`;
      
      if (actions.length === 0) {
        return `// ${principalType} Resource Access Policy
// Configure actions to generate the policy

permit (
  ${principalClause},
  action == Action::"<action>",
  ${resourceClause}
);`;
      }
      
      if (actions.length === 1) {
        return `// ${principalType} Resource Access Policy
// ${principalType} ${principalId} can ${actions[0]} ${hasResourceType || "all"} resources

permit (
  ${principalClause},
  action == Action::"${actions[0]}",
  ${resourceClause}
);`;
      }
      
      return `// ${principalType} Resource Access Policy
// ${principalType} ${principalId} can perform specified actions

${actions.map((action) => `permit (
  ${principalClause},
  action == Action::"${action}",
  ${resourceClause}
);`).join("\n\n")}`;
    },
  },
  // ========== OWNERSHIP TEMPLATES ==========
  {
    id: "owner-access",
    name: "Owner Access",
    description: "Allow users to access resources they own (via owner attribute)",
    icon: <UserOutlined />,
    category: "ownership",
    variables: [
      {
        key: "actions",
        label: "Allowed Actions",
        description: "Actions the owner can perform (comma-separated)",
        type: "text",
        placeholder: "view, edit, delete",
        required: true,
      },
      {
        key: "resourceType",
        label: "Resource Type (optional)",
        description: "Limit to a specific resource type",
        type: "text",
        placeholder: "Document",
        required: false,
      },
    ],
    generatePolicy: (values) => {
      const actions = (values.actions || "").split(",").map((a) => a.trim()).filter(Boolean);
      const hasResourceType = values.resourceType?.trim();
      const resourceClause = hasResourceType ? `resource is ${values.resourceType}` : "resource";
      
      if (actions.length === 0) {
        return `// Owner Access Policy
// Configure actions to generate the policy

permit (
  principal,
  action == Action::"<action>",
  ${resourceClause}
) when {
  resource.owner == principal
};`;
      }
      
      if (actions.length === 1) {
        return `// Owner Access Policy
// Users can ${actions[0]} ${hasResourceType || ""} resources they own

permit (
  principal,
  action == Action::"${actions[0]}",
  ${resourceClause}
) when {
  resource.owner == principal
};`;
      }
      return `// Owner Access Policy
// Users can perform specified actions on ${hasResourceType || ""} resources they own

${actions.map((action) => `permit (
  principal,
  action == Action::"${action}",
  ${resourceClause}
) when {
  resource.owner == principal
};`).join("\n\n")}`;
    },
  },
  // ========== HIERARCHY TEMPLATES ==========
  {
    id: "folder-hierarchy",
    name: "Folder/Container Hierarchy Access",
    description: "Grant access to all resources within a container hierarchy",
    icon: <FileOutlined />,
    category: "hierarchy",
    variables: [
      {
        key: "principalId",
        label: "User or Group",
        description: "Select a user or group from Entra ID",
        type: "entra-both",
        placeholder: "Select user or group...",
        required: true,
      },
      {
        key: "principalType",
        label: "Principal Type",
        description: "Is this a User or Group?",
        type: "select",
        options: [
          { value: "User", label: "User" },
          { value: "Group", label: "Group" },
        ],
        required: true,
      },
      {
        key: "containerType",
        label: "Container Type",
        description: "The type of container (e.g., Folder, Project, Team)",
        type: "text",
        placeholder: "Folder",
        required: true,
      },
      {
        key: "containerId",
        label: "Container ID",
        description: "The ID of the parent container",
        type: "text",
        placeholder: "shared-docs",
        required: true,
      },
      {
        key: "actions",
        label: "Actions (comma-separated)",
        description: "Actions to allow",
        type: "text",
        placeholder: "view, edit",
        required: true,
      },
    ],
    generatePolicy: (values) => {
      const actions = (values.actions || "").split(",").map((a) => a.trim()).filter(Boolean);
      const isGroup = values.principalType === "Group";
      const principalId = values.principalId || "<principal>";
      const principalType = values.principalType || "User";
      const containerType = values.containerType || "Folder";
      const containerId = values.containerId || "<container>";
      
      const principalClause = isGroup 
        ? `principal in Group::"${principalId}"`
        : `principal == User::"${principalId}"`;
      
      if (actions.length === 0) {
        return `// Hierarchy Access Policy
// Configure actions to generate the policy

permit (
  ${principalClause},
  action == Action::"<action>",
  resource in ${containerType}::"${containerId}"
);`;
      }
      
      if (actions.length === 1) {
        return `// Hierarchy Access Policy
// ${principalType} ${principalId} can ${actions[0]} resources in ${containerType} ${containerId}

permit (
  ${principalClause},
  action == Action::"${actions[0]}",
  resource in ${containerType}::"${containerId}"
);`;
      }
      
      return `// Hierarchy Access Policy
// ${principalType} ${principalId} can perform actions on resources in ${containerType} ${containerId}

${actions.map((action) => `permit (
  ${principalClause},
  action == Action::"${action}",
  resource in ${containerType}::"${containerId}"
);`).join("\n\n")}`;
    },
  },
  // ========== ABAC TEMPLATES ==========
  {
    id: "public-read",
    name: "Public Read Access",
    description: "Allow all users to view resources marked as public",
    icon: <UnlockOutlined />,
    category: "abac",
    variables: [
      {
        key: "resourceType",
        label: "Resource Type",
        description: "The type of resource",
        type: "text",
        placeholder: "Document",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Public Read Access Policy
// Anyone can view ${values.resourceType} resources marked as public

permit (
  principal,
  action == Action::"view",
  resource is ${values.resourceType}
) when {
  resource.isPublic == true
};`,
  },
  {
    id: "time-based-access",
    name: "Context-Based Access",
    description: "Allow access based on context attributes (e.g., time, location, device)",
    icon: <InfoCircleOutlined />,
    category: "abac",
    variables: [
      {
        key: "contextAttribute",
        label: "Context Attribute",
        description: "The context attribute to check",
        type: "text",
        placeholder: "isBusinessHours",
        required: true,
      },
      {
        key: "action",
        label: "Action",
        description: "The action to allow",
        type: "text",
        placeholder: "edit",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Context-Based Access Policy
// Allow ${values.action} only when ${values.contextAttribute} is true

permit (
  principal,
  action == Action::"${values.action}",
  resource
) when {
  context.${values.contextAttribute} == true
};`,
  },
  {
    id: "deny-external",
    name: "Deny External Access",
    description: "Explicitly deny access for external users",
    icon: <LockOutlined />,
    category: "abac",
    variables: [
      {
        key: "action",
        label: "Action to Deny",
        description: "The action to deny for external users",
        type: "text",
        placeholder: "delete",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Deny External Access Policy
// Deny ${values.action} for users marked as external

forbid (
  principal,
  action == Action::"${values.action}",
  resource
) when {
  principal.isExternal == true
};`,
  },
  {
    id: "viewer-editor-roles",
    name: "Viewer/Editor Roles",
    description: "Create viewer and editor role policies for a resource type",
    icon: <TeamOutlined />,
    category: "rbac",
    variables: [
      {
        key: "resourceType",
        label: "Resource Type",
        description: "The type of resource",
        type: "text",
        placeholder: "Document",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Viewer/Editor Role Policies for ${values.resourceType}

// Viewers can only view
permit (
  principal,
  action == Action::"view",
  resource is ${values.resourceType}
) when {
  principal in resource.viewers
};

// Editors can view and edit
permit (
  principal,
  action == Action::"view",
  resource is ${values.resourceType}
) when {
  principal in resource.editors
};

permit (
  principal,
  action == Action::"edit",
  resource is ${values.resourceType}
) when {
  principal in resource.editors
};`,
  },
];

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  rbac: { label: "Role-Based", color: "blue" },
  abac: { label: "Attribute-Based", color: "purple" },
  ownership: { label: "Ownership", color: "green" },
  hierarchy: { label: "Hierarchy", color: "orange" },
};

export default function PolicyTemplateWizard({
  open,
  onClose,
  onSubmit,
  saving,
  approvalRequired,
  entityTypes = [],
  actions = [],
}: PolicyTemplateWizardProps) {
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<PolicyTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [policyName, setPolicyName] = useState("");
  const [policyDescription, setPolicyDescription] = useState("");
  const [activate, setActivate] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [identityProvider, setIdentityProvider] = useState<IdentityProvider | null>(null);

  // Fetch identity provider on mount
  useEffect(() => {
    api.getIdentityProvider()
      .then(setIdentityProvider)
      .catch(() => setIdentityProvider({ provider: "none" }));
  }, []);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep(0);
      setSelectedTemplate(null);
      setVariableValues({});
      setPolicyName("");
      setPolicyDescription("");
      setActivate(true);
      setCategoryFilter(null);
    }
  }, [open]);

  // Auto-generate policy name from template
  useEffect(() => {
    if (selectedTemplate && !policyName) {
      setPolicyName(selectedTemplate.id);
      setPolicyDescription(selectedTemplate.description);
    }
  }, [selectedTemplate]);

  const filteredTemplates = categoryFilter
    ? POLICY_TEMPLATES.filter((t) => t.category === categoryFilter)
    : POLICY_TEMPLATES;

  const generatedPolicy = selectedTemplate
    ? selectedTemplate.generatePolicy(variableValues)
    : "";

  const canProceedStep1 = selectedTemplate !== null;
  const canProceedStep2 = selectedTemplate?.variables.every(
    (v) => !v.required || variableValues[v.key]?.trim()
  );
  const canProceedStep3 = policyName.trim() !== "";

  async function handleSubmit() {
    await onSubmit(policyName, policyDescription, generatedPolicy, activate);
  }

  return (
    <Modal
      open={open}
      title={
        <Space>
          <span>Policy Template Wizard</span>
          <Tag color="blue">Step {step + 1} of 4</Tag>
        </Space>
      }
      onCancel={onClose}
      footer={null}
      width={850}
      destroyOnClose
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: "Template" },
          { title: "Configure" },
          { title: "Details" },
          { title: "Review" },
        ]}
      />

      {/* Step 0: Select Template */}
      {step === 0 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Choose a Policy Template"
            description="Select a pre-built template that matches your authorization pattern. You'll configure the details in the next step."
          />

          <Space wrap>
            <Button
              size="small"
              type={categoryFilter === null ? "primary" : "default"}
              onClick={() => setCategoryFilter(null)}
            >
              All
            </Button>
            {Object.entries(CATEGORY_LABELS).map(([key, { label, color }]) => (
              <Button
                key={key}
                size="small"
                type={categoryFilter === key ? "primary" : "default"}
                onClick={() => setCategoryFilter(key)}
              >
                {label}
              </Button>
            ))}
          </Space>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {filteredTemplates.map((template) => (
              <Card
                key={template.id}
                size="small"
                hoverable
                onClick={() => setSelectedTemplate(template)}
                style={{
                  cursor: "pointer",
                  border: selectedTemplate?.id === template.id ? "2px solid #1890ff" : undefined,
                  background: selectedTemplate?.id === template.id ? "#e6f7ff" : undefined,
                }}
              >
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Space>
                    {template.icon}
                    <Typography.Text strong>{template.name}</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {template.description}
                  </Typography.Text>
                  <Tag color={CATEGORY_LABELS[template.category].color} style={{ marginTop: 4 }}>
                    {CATEGORY_LABELS[template.category].label}
                  </Tag>
                </Space>
              </Card>
            ))}
          </div>
        </Space>
      )}

      {/* Step 1: Configure Variables */}
      {step === 1 && selectedTemplate && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message={`Configure: ${selectedTemplate.name}`}
            description="Fill in the values below to customize the policy template."
          />

          {(entityTypes.length > 0 || actions.length > 0) && (
            <Alert
              type="success"
              showIcon
              message="Schema Detected"
              description={
                <Space direction="vertical" size={4}>
                  {entityTypes.length > 0 && (
                    <span>
                      <strong>Resource Types:</strong>{" "}
                      {entityTypes.slice(0, 5).map((t) => (
                        <Tag key={t} color="green" style={{ marginBottom: 2 }}>{t}</Tag>
                      ))}
                      {entityTypes.length > 5 && <Tag color="default">+{entityTypes.length - 5} more</Tag>}
                    </span>
                  )}
                  {actions.length > 0 && (
                    <span>
                      <strong>Actions:</strong>{" "}
                      {actions.slice(0, 5).map((a) => (
                        <Tag key={a} color="purple" style={{ marginBottom: 2 }}>{a}</Tag>
                      ))}
                      {actions.length > 5 && <Tag color="default">+{actions.length - 5} more</Tag>}
                    </span>
                  )}
                </Space>
              }
              style={{ marginBottom: 8 }}
            />
          )}

          {selectedTemplate.variables.map((variable) => (
            <div key={variable.key}>
              <Space style={{ marginBottom: 4 }}>
                <Typography.Text strong>{variable.label}</Typography.Text>
                {variable.required && <Tag color="red">Required</Tag>}
                {(variable.type === "entra-user" || variable.type === "entra-group" || variable.type === "entra-both" ||
                  variable.type === "identity-user" || variable.type === "identity-group" || variable.type === "identity-both") && (
                  identityProvider?.provider === "ad" ? (
                    <Tag color="blue" icon={<CloudServerOutlined />}>Active Directory</Tag>
                  ) : (
                    <Tag color="cyan" icon={<CloudOutlined />}>Entra ID</Tag>
                  )
                )}
              </Space>
              <Typography.Paragraph type="secondary" style={{ margin: "4px 0 8px" }}>
                {variable.description}
              </Typography.Paragraph>
              {variable.type === "text" && (
                <>
                  {/* Show dropdown for resourceType if schema has entity types */}
                  {variable.key === "resourceType" && entityTypes.length > 0 ? (
                    <Select
                      style={{ width: "100%" }}
                      allowClear
                      showSearch
                      value={variableValues[variable.key] || undefined}
                      onChange={(v) => setVariableValues({ ...variableValues, [variable.key]: v || "" })}
                      placeholder="Select from schema or type custom..."
                      options={entityTypes.map(t => ({ value: t, label: t }))}
                      dropdownRender={(menu) => (
                        <>
                          {menu}
                          <div style={{ padding: 8, borderTop: "1px solid #f0f0f0" }}>
                            <Input
                              size="small"
                              placeholder="Or enter custom type..."
                              value={variableValues[variable.key] || ""}
                              onChange={(e) => setVariableValues({ ...variableValues, [variable.key]: e.target.value })}
                            />
                          </div>
                        </>
                      )}
                    />
                  ) : variable.key === "actions" && actions.length > 0 ? (
                    /* Show multi-select for actions if schema has actions */
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={variableValues[variable.key]?.split(",").map(a => a.trim()).filter(Boolean) || []}
                      onChange={(values) => setVariableValues({ ...variableValues, [variable.key]: values.join(", ") })}
                      placeholder="Select actions from schema..."
                      options={actions.map(a => ({ value: a, label: a }))}
                    />
                  ) : variable.key === "action" && actions.length > 0 ? (
                    /* Single action selection */
                    <Select
                      style={{ width: "100%" }}
                      allowClear
                      showSearch
                      value={variableValues[variable.key] || undefined}
                      onChange={(v) => setVariableValues({ ...variableValues, [variable.key]: v || "" })}
                      placeholder="Select action from schema..."
                      options={actions.map(a => ({ value: a, label: a }))}
                      dropdownRender={(menu) => (
                        <>
                          {menu}
                          <div style={{ padding: 8, borderTop: "1px solid #f0f0f0" }}>
                            <Input
                              size="small"
                              placeholder="Or enter custom action..."
                              value={variableValues[variable.key] || ""}
                              onChange={(e) => setVariableValues({ ...variableValues, [variable.key]: e.target.value })}
                            />
                          </div>
                        </>
                      )}
                    />
                  ) : variable.key === "containerType" && entityTypes.length > 0 ? (
                    /* Container type selection from entity types */
                    <Select
                      style={{ width: "100%" }}
                      allowClear
                      showSearch
                      value={variableValues[variable.key] || undefined}
                      onChange={(v) => setVariableValues({ ...variableValues, [variable.key]: v || "" })}
                      placeholder="Select container type..."
                      options={entityTypes.map(t => ({ value: t, label: t }))}
                      dropdownRender={(menu) => (
                        <>
                          {menu}
                          <div style={{ padding: 8, borderTop: "1px solid #f0f0f0" }}>
                            <Input
                              size="small"
                              placeholder="Or enter custom type..."
                              value={variableValues[variable.key] || ""}
                              onChange={(e) => setVariableValues({ ...variableValues, [variable.key]: e.target.value })}
                            />
                          </div>
                        </>
                      )}
                    />
                  ) : (
                    /* Default text input */
                    <Input
                      value={variableValues[variable.key] || ""}
                      onChange={(e) =>
                        setVariableValues({ ...variableValues, [variable.key]: e.target.value })
                      }
                      placeholder={variable.placeholder}
                    />
                  )}
                </>
              )}
              {variable.type === "select" && variable.options && (
                <Select
                  style={{ width: "100%" }}
                  value={variableValues[variable.key]}
                  onChange={(v) => setVariableValues({ ...variableValues, [variable.key]: v })}
                  placeholder={variable.placeholder}
                  options={variable.options}
                />
              )}
              {/* Identity picker - uses Entra or AD based on configured provider */}
              {(variable.type === "entra-user" || variable.type === "entra-group" || variable.type === "entra-both" ||
                variable.type === "identity-user" || variable.type === "identity-group" || variable.type === "identity-both") && (
                <Space direction="vertical" style={{ width: "100%" }}>
                  {/* Show Entra picker when Entra is configured or for entra-* types */}
                  {(identityProvider?.provider === "entra" || variable.type.startsWith("entra-")) && identityProvider?.provider !== "ad" && (
                    <EntraPicker
                      mode="single"
                      allowedTypes={
                        variable.type === "entra-user" || variable.type === "identity-user" ? ["User"] :
                        variable.type === "entra-group" || variable.type === "identity-group" ? ["Group"] :
                        ["User", "Group"]
                      }
                      value={
                        variableValues[variable.key]
                          ? [{
                              type: (variableValues[`${variable.key}_type`] as "User" | "Group") || 
                                    (variable.type.includes("user") ? "User" : "Group"),
                              id: variableValues[variable.key],
                              displayName: variableValues[`${variable.key}_name`] || variableValues[variable.key],
                            }]
                          : []
                      }
                      onChange={(selections: EntraSelection[]) => {
                        if (selections.length > 0) {
                          const newValues: Record<string, string> = {
                            ...variableValues,
                            [variable.key]: selections[0].id,
                            [`${variable.key}_name`]: selections[0].displayName,
                          };
                          if (variable.type.includes("both")) {
                            newValues[`${variable.key}_type`] = selections[0].type;
                            const typeKey = variable.key.replace(/Id$/, "Type");
                            if (selectedTemplate?.variables.some(v => v.key === typeKey)) {
                              newValues[typeKey] = selections[0].type;
                            }
                          }
                          setVariableValues(newValues);
                        } else {
                          setVariableValues({
                            ...variableValues,
                            [variable.key]: "",
                            [`${variable.key}_name`]: "",
                            [`${variable.key}_type`]: "",
                          });
                        }
                      }}
                      placeholder={`Search Entra for ${variable.type.includes("user") ? "users" : variable.type.includes("group") ? "groups" : "users/groups"}...`}
                    />
                  )}
                  {/* Show AD picker when AD is configured */}
                  {identityProvider?.provider === "ad" && (
                    <ADPicker
                      mode="single"
                      allowedTypes={
                        variable.type === "entra-user" || variable.type === "identity-user" ? ["User"] :
                        variable.type === "entra-group" || variable.type === "identity-group" ? ["Group"] :
                        ["User", "Group"]
                      }
                      value={
                        variableValues[variable.key]
                          ? [{
                              type: (variableValues[`${variable.key}_type`] as "User" | "Group") || 
                                    (variable.type.includes("user") ? "User" : "Group"),
                              id: variableValues[variable.key],
                              displayName: variableValues[`${variable.key}_name`] || variableValues[variable.key],
                            }]
                          : []
                      }
                      onChange={(selections: ADSelection[]) => {
                        if (selections.length > 0) {
                          const newValues: Record<string, string> = {
                            ...variableValues,
                            [variable.key]: selections[0].id,
                            [`${variable.key}_name`]: selections[0].displayName,
                          };
                          if (variable.type.includes("both")) {
                            newValues[`${variable.key}_type`] = selections[0].type;
                            const typeKey = variable.key.replace(/Id$/, "Type");
                            if (selectedTemplate?.variables.some(v => v.key === typeKey)) {
                              newValues[typeKey] = selections[0].type;
                            }
                          }
                          setVariableValues(newValues);
                        } else {
                          setVariableValues({
                            ...variableValues,
                            [variable.key]: "",
                            [`${variable.key}_name`]: "",
                            [`${variable.key}_type`]: "",
                          });
                        }
                      }}
                      placeholder={`Search AD for ${variable.type.includes("user") ? "users" : variable.type.includes("group") ? "groups" : "users/groups"}...`}
                    />
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Or enter manually:
                  </Typography.Text>
                  <Input
                    size="small"
                    value={variableValues[variable.key] || ""}
                    onChange={(e) =>
                      setVariableValues({ ...variableValues, [variable.key]: e.target.value })
                    }
                    placeholder={variable.placeholder}
                  />
                </Space>
              )}
            </div>
          ))}

          <Card size="small" title="Policy Preview">
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "#1e1e1e",
                color: "#d4d4d4",
                borderRadius: 4,
                maxHeight: 200,
                overflow: "auto",
                fontSize: 12,
                fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {generatedPolicy || "// Fill in the required fields to see the policy"}
            </pre>
          </Card>
        </Space>
      )}

      {/* Step 2: Policy Details */}
      {step === 2 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Policy Details"
            description="Give your policy a unique name and optional description."
          />

          <div>
            <Typography.Text strong>Policy Name</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 8px" }}>
              A unique identifier for this policy (e.g., "admin-full-access", "owner-documents")
            </Typography.Paragraph>
            <Input
              value={policyName}
              onChange={(e) => setPolicyName(e.target.value)}
              placeholder="my-policy-name"
            />
          </div>

          <div>
            <Typography.Text strong>Description</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 8px" }}>
              A human-readable description of what this policy does
            </Typography.Paragraph>
            <Input.TextArea
              value={policyDescription}
              onChange={(e) => setPolicyDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
            />
          </div>
        </Space>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="success"
            showIcon
            message="Review Your Policy"
            description="Review the generated Cedar policy below before creating it."
          />

          <Card size="small" title="Policy Summary">
            <Space direction="vertical" size={8}>
              <Typography.Text>
                <strong>Name:</strong> {policyName}
              </Typography.Text>
              <Typography.Text>
                <strong>Template:</strong> {selectedTemplate?.name}
              </Typography.Text>
              <Typography.Text>
                <strong>Description:</strong> {policyDescription || "—"}
              </Typography.Text>
            </Space>
          </Card>

          <Card size="small" title="Generated Cedar Policy">
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "#1e1e1e",
                color: "#d4d4d4",
                borderRadius: 4,
                maxHeight: 300,
                overflow: "auto",
                fontSize: 12,
                fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {generatedPolicy}
            </pre>
          </Card>

          {approvalRequired && (
            <Alert
              type="info"
              showIcon
              message="Approval Required"
              description="This application requires approval for policy changes. Checking the box below will submit the policy for approval. Unchecking it will save as Draft."
              style={{ marginBottom: 12 }}
            />
          )}
          <Checkbox checked={activate} onChange={(e) => setActivate(e.target.checked)}>
            {approvalRequired
              ? "Submit for approval"
              : "Activate this policy immediately"}
          </Checkbox>
        </Space>
      )}

      <Divider />

      {/* Navigation */}
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Space>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {step === 0 && (
            <Button type="primary" onClick={() => setStep(1)} disabled={!canProceedStep1}>
              Next: Configure
            </Button>
          )}
          {step === 1 && (
            <Button type="primary" onClick={() => setStep(2)} disabled={!canProceedStep2}>
              Next: Details
            </Button>
          )}
          {step === 2 && (
            <Button type="primary" onClick={() => setStep(3)} disabled={!canProceedStep3}>
              Next: Review
            </Button>
          )}
          {step === 3 && (
            <Button type="primary" onClick={handleSubmit} loading={saving}>
              Create Policy
            </Button>
          )}
        </Space>
      </Space>
    </Modal>
  );
}

