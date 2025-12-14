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
} from "@ant-design/icons";

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
  type: "text" | "select" | "multi-select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};

type PolicyTemplateWizardProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string, policyText: string, activate: boolean) => Promise<void>;
  saving: boolean;
  entityTypes?: string[];
  actions?: string[];
};

const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "allow-all-admins",
    name: "Admin Full Access",
    description: "Grant full access to all resources for admin group members",
    icon: <LockOutlined />,
    category: "rbac",
    variables: [
      {
        key: "adminGroup",
        label: "Admin Group ID",
        description: "The ID of the admin group (e.g., 'admins', 'superusers')",
        type: "text",
        placeholder: "admins",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Admin Full Access Policy
// Members of the ${values.adminGroup} group have full access to all resources

permit (
  principal in Group::"${values.adminGroup}",
  action,
  resource
);`,
  },
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
        description: "Actions the owner can perform",
        type: "text",
        placeholder: "view, edit, delete",
        required: true,
      },
    ],
    generatePolicy: (values) => {
      const actions = values.actions.split(",").map((a) => a.trim()).filter(Boolean);
      if (actions.length === 1) {
        return `// Owner Access Policy
// Users can ${actions[0]} resources they own

permit (
  principal,
  action == Action::"${actions[0]}",
  resource
) when {
  resource.owner == principal
};`;
      }
      return `// Owner Access Policy
// Users can perform specified actions on resources they own

${actions.map((action) => `permit (
  principal,
  action == Action::"${action}",
  resource
) when {
  resource.owner == principal
};`).join("\n\n")}`;
    },
  },
  {
    id: "group-resource-access",
    name: "Group Resource Access",
    description: "Allow group members to access specific resources assigned to the group",
    icon: <TeamOutlined />,
    category: "rbac",
    variables: [
      {
        key: "groupId",
        label: "Group ID",
        description: "The ID of the group to grant access",
        type: "text",
        placeholder: "engineering",
        required: true,
      },
      {
        key: "resourceType",
        label: "Resource Type",
        description: "The type of resource to grant access to",
        type: "text",
        placeholder: "Document",
        required: true,
      },
      {
        key: "action",
        label: "Action",
        description: "The action to allow",
        type: "text",
        placeholder: "view",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Group Resource Access Policy
// Members of ${values.groupId} can ${values.action} ${values.resourceType} resources

permit (
  principal in Group::"${values.groupId}",
  action == Action::"${values.action}",
  resource is ${values.resourceType}
);`,
  },
  {
    id: "folder-hierarchy",
    name: "Folder Hierarchy Access",
    description: "Grant access to all documents within a folder hierarchy",
    icon: <FileOutlined />,
    category: "hierarchy",
    variables: [
      {
        key: "folderId",
        label: "Folder ID",
        description: "The ID of the parent folder",
        type: "text",
        placeholder: "shared-docs",
        required: true,
      },
      {
        key: "groupId",
        label: "Group ID",
        description: "The group that should have access",
        type: "text",
        placeholder: "team-alpha",
        required: true,
      },
      {
        key: "action",
        label: "Action",
        description: "The action to allow",
        type: "text",
        placeholder: "view",
        required: true,
      },
    ],
    generatePolicy: (values) => `// Folder Hierarchy Access Policy
// Members of ${values.groupId} can ${values.action} documents in folder ${values.folderId}

permit (
  principal in Group::"${values.groupId}",
  action == Action::"${values.action}",
  resource in Folder::"${values.folderId}"
);`,
  },
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
}: PolicyTemplateWizardProps) {
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<PolicyTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [policyName, setPolicyName] = useState("");
  const [policyDescription, setPolicyDescription] = useState("");
  const [activate, setActivate] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

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

          {selectedTemplate.variables.map((variable) => (
            <div key={variable.key}>
              <Space style={{ marginBottom: 4 }}>
                <Typography.Text strong>{variable.label}</Typography.Text>
                {variable.required && <Tag color="red">Required</Tag>}
              </Space>
              <Typography.Paragraph type="secondary" style={{ margin: "4px 0 8px" }}>
                {variable.description}
              </Typography.Paragraph>
              {variable.type === "text" && (
                <Input
                  value={variableValues[variable.key] || ""}
                  onChange={(e) =>
                    setVariableValues({ ...variableValues, [variable.key]: e.target.value })
                  }
                  placeholder={variable.placeholder}
                />
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
            </div>
          ))}

          <Card size="small" title="Preview">
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "#f5f5f5",
                borderRadius: 4,
                maxHeight: 200,
                overflow: "auto",
                fontSize: 12,
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
                background: "#f5f5f5",
                borderRadius: 4,
                maxHeight: 300,
                overflow: "auto",
                fontSize: 12,
              }}
            >
              {generatedPolicy}
            </pre>
          </Card>

          <Checkbox checked={activate} onChange={(e) => setActivate(e.target.checked)}>
            Activate this policy immediately
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

