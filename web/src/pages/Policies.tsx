import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Alert, Button, Card, Checkbox, Col, Input, Modal, Popconfirm, Radio, Row, Select, Space, Steps, Table, Tabs, Tag, Tooltip, Typography, theme, message } from "antd";
import { DeleteOutlined, FileTextOutlined, PlusOutlined, ThunderboltOutlined, EyeOutlined, AppstoreOutlined, ExperimentOutlined } from "@ant-design/icons";
import { api, type Application, type AuthorizeResponse, type CedarEntity, type PolicyDetails, type PolicySummary, type Schema, type SchemaMetadata } from "../api";
import PolicyTemplateWizard from "../components/PolicyTemplateWizard";
import PolicySimulator from "../components/PolicySimulator";
import { usePolicyUpdates } from "../contexts/SSEContext";
import { normalizeSchemaMetadata, parseSchemaMetadataFromText } from "../schemaMetadata";

const DEFAULT_POLICY = `permit (
  principal == User::"alice",
  action == Action::"view",
  resource == Document::"demo-doc"
);`;

const POLICY_TEMPLATE_STORAGE_KEY = "cedar.policy.reusable_templates.v1";

type ReusablePolicyTemplate = {
  id: string;
  name: string;
  description: string;
  intent: "permit" | "forbid";
  principalType: string;
  principalId: string;
  actions: string[];
  resourceType: string;
  resourceId: string;
  conditionsText: string;
  policyText: string;
  createdAt: string;
};

export default function Policies() {
  const { token } = theme.useToken();
  const [apps, setApps] = useState<Application[]>([]);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const [savingPolicy, setSavingPolicy] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);

  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);

  const [selectedPolicy, setSelectedPolicy] = useState<PolicyDetails | null>(null);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyModalLoading, setPolicyModalLoading] = useState(false);

  const [editDescription, setEditDescription] = useState("");
  const [editPolicyText, setEditPolicyText] = useState("");
  const [editActivate, setEditActivate] = useState(true);
  const [savingExisting, setSavingExisting] = useState(false);

  const [entities, setEntities] = useState<CedarEntity[]>([]);

  const [activeSchema, setActiveSchema] = useState<Schema | null>(null);
  const [activeSchemaMetadata, setActiveSchemaMetadata] = useState<SchemaMetadata | null>(null);
  const [policyValidationWarnings, setPolicyValidationWarnings] = useState<string[]>([]);

  const [selectedAppId, setSelectedAppId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [policyText, setPolicyText] = useState(DEFAULT_POLICY);
  const [activate, setActivate] = useState(true);
  const [intent, setIntent] = useState<"permit" | "forbid">("permit");
  const [scopePrincipalType, setScopePrincipalType] = useState("User");
  const [scopePrincipalId, setScopePrincipalId] = useState("alice");
  const [scopeActions, setScopeActions] = useState<string[]>(["Action:view"]);
  const [scopeResourceType, setScopeResourceType] = useState("Document");
  const [scopeResourceId, setScopeResourceId] = useState("demo-doc");
  const [conditionsText, setConditionsText] = useState("");
  const [savedTemplates, setSavedTemplates] = useState<ReusablePolicyTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");

  const [authzPrincipal, setAuthzPrincipal] = useState("User:alice");
  const [authzAction, setAuthzAction] = useState("Action:view");
  const [authzResource, setAuthzResource] = useState("Document:demo-doc");
  const [authzContextJson, setAuthzContextJson] = useState("{}");
  const [authzResult, setAuthzResult] = useState<AuthorizeResponse | null>(null);

  const [activeTab, setActiveTab] = useState("view");
  const [templateWizardOpen, setTemplateWizardOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // Debug logging for simulator
  console.log('[Policies] simulatorOpen:', simulatorOpen, 'selectedPolicy:', selectedPolicy?.id, 'editPolicyText length:', editPolicyText.length);

  const selectedApp = useMemo(() => apps.find((a) => a.id === selectedAppId), [apps, selectedAppId]);

  // Load policies function that can be called from SSE handler
  const loadPolicies = useCallback(async () => {
    if (selectedAppId === "") {
      setPolicies([]);
      return;
    }
    setPoliciesLoading(true);
    try {
      const items = await api.listPolicies(selectedAppId);
      setPolicies(Array.isArray(items) ? items : []);
    } catch (e) {
      setError((e as Error).message);
      setPolicies([]);
    } finally {
      setPoliciesLoading(false);
    }
  }, [selectedAppId]);

  // Track last SSE refresh to debounce
  const lastSSERefresh = useRef<number>(0);

  // Subscribe to policy updates via SSE
  usePolicyUpdates(useCallback((event) => {
    // Only refresh if the update is for the currently selected app
    if (selectedAppId !== "" && (event.data?.application_id === selectedAppId || !event.data?.application_id)) {
      // Debounce: Don't refresh more than once per 3 seconds
      const now = Date.now();
      if (now - lastSSERefresh.current < 3000) {
        console.log('[Policies] Skipping SSE refresh - too soon');
        return;
      }
      lastSSERefresh.current = now;
      
      console.log('[Policies] Received policy update via SSE, refreshing...');
      message.info({ content: 'Policy updated - refreshing list...', key: 'sse-refresh', duration: 2 });
      loadPolicies();
    }
  }, [selectedAppId, loadPolicies]));

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const data = await api.listApps();
        setApps(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(POLICY_TEMPLATE_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as ReusablePolicyTemplate[];
      if (Array.isArray(parsed)) {
        setSavedTemplates(parsed);
      }
    } catch {
      // Ignore malformed localStorage values.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(POLICY_TEMPLATE_STORAGE_KEY, JSON.stringify(savedTemplates));
  }, [savedTemplates]);

  useEffect(() => {
    if (selectedAppId === "" && apps.length > 0) {
      setSelectedAppId(apps[0].id);
    }
  }, [apps, selectedAppId]);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  useEffect(() => {
    if (selectedAppId === "") {
      setEntities([]);
      setActiveSchema(null);
      return;
    }

    (async () => {
      try {
        const items = await api.listEntities(selectedAppId);
        setEntities(Array.isArray(items) ? items : []);
      } catch (e) {
        setEntities([]);
      }
    })();

    // Fetch active schema to get entity types and actions
    (async () => {
      try {
        const schema = await api.getActiveSchema(selectedAppId as number);
        setActiveSchema(schema);
      } catch (e) {
        setActiveSchema(null);
      }
    })();
  }, [selectedAppId]);

  useEffect(() => {
    let cancelled = false;
    if (selectedAppId === "") {
      setActiveSchemaMetadata(null);
      return;
    }
    (async () => {
      try {
        const metadata = await api.getActiveSchemaMetadata(selectedAppId as number);
        if (!cancelled) {
          setActiveSchemaMetadata(metadata);
        }
      } catch {
        const fallback = activeSchema?.schema_text
          ? parseSchemaMetadataFromText(activeSchema.schema_text)
          : null;
        if (!cancelled) {
          setActiveSchemaMetadata(fallback);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAppId, activeSchema?.schema_text]);

  const normalizedSchema = useMemo(
    () => normalizeSchemaMetadata(activeSchemaMetadata),
    [activeSchemaMetadata]
  );

  // Parse entity types from both schema and actual entities
  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    
    // Add types from actual entities
    const safeEntities = Array.isArray(entities) ? entities : [];
    for (const e of safeEntities) {
      if (e?.uid?.type) set.add(e.uid.type);
    }
    
    // Add schema-derived types (namespace-aware).
    for (const typeName of normalizedSchema.entityTypes) {
      set.add(typeName);
    }
    
    return Array.from(set).sort();
  }, [entities, normalizedSchema.entityTypes]);

  // Parse actions from active schema
  const schemaActions = useMemo(() => {
    return normalizedSchema.actionIds;
  }, [normalizedSchema.actionIds]);

  const schemaActionRefs = useMemo(() => normalizedSchema.actionRefs, [normalizedSchema.actionRefs]);

  const entityIdsByType = useMemo(() => {
    const map = new Map<string, string[]>();
    const safeEntities = Array.isArray(entities) ? entities : [];
    for (const e of safeEntities) {
      const t = e?.uid?.type;
      const id = e?.uid?.id;
      if (!t || !id) continue;
      const arr = map.get(t) ?? [];
      arr.push(id);
      map.set(t, arr);
    }
    for (const [k, v] of map.entries()) {
      map.set(k, Array.from(new Set(v)).sort());
    }
    return map;
  }, [entities]);

  const principalTypeOptions = useMemo(
    () => entityTypes.filter((t) => t === "User" || t === "Group" || t.endsWith("::User") || t.endsWith("::Group")),
    [entityTypes]
  );

  const actionOptions = useMemo(
    () => schemaActionRefs.map((a) => `${a.actionType}:${a.actionId}`),
    [schemaActionRefs]
  );
  const scopeEntityTypeOptions = useMemo(
    () => (entityTypes.length > 0 ? entityTypes : ["User", "Group", "Document", "Folder", "Resource"]),
    [entityTypes]
  );

  const principalIdOptions = useMemo(() => entityIdsByType.get(scopePrincipalType) ?? [], [entityIdsByType, scopePrincipalType]);
  const resourceIdOptions = useMemo(() => entityIdsByType.get(scopeResourceType) ?? [], [entityIdsByType, scopeResourceType]);

  const parsedConditions = useMemo(
    () =>
      conditionsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [conditionsText]
  );

  const generatedPolicyText = useMemo(() => {
    const escapeCedarString = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const principalRef = resolveBuilderRef(scopePrincipalType, scopePrincipalId);
    const resourceRef = resolveBuilderRef(scopeResourceType, scopeResourceId);
    const principalOperator = principalRef.type === "Group" || principalRef.type.endsWith("::Group") ? "in" : "==";
    const validActions = scopeActions
      .map((raw) => parseRef(raw))
      .filter((value) => value.type && value.id);
    const actionsToUse = validActions.length > 0 ? validActions : [{ type: "Action", id: "view" }];

    const whenClause =
      parsedConditions.length > 0
        ? `\n) when {\n  ${parsedConditions.join("\n  && ")}\n};`
        : `\n);`;

    return actionsToUse
      .map(
        (actionRef) => `${intent} (
  principal ${principalOperator} ${principalRef.type}::"${escapeCedarString(principalRef.id)}",
  action == ${actionRef.type}::"${escapeCedarString(actionRef.id)}",
  resource == ${resourceRef.type}::"${escapeCedarString(resourceRef.id)}"${whenClause}`
      )
      .join("\n\n");
  }, [intent, scopePrincipalType, scopePrincipalId, scopeActions, scopeResourceType, scopeResourceId, parsedConditions]);

  const builderValidationIssues = useMemo(() => {
    const issues: string[] = [];
    const principalRef = resolveBuilderRef(scopePrincipalType, scopePrincipalId);
    const resourceRef = resolveBuilderRef(scopeResourceType, scopeResourceId);
    if (!name.trim()) issues.push("Add a policy name in Step 1.");
    if (!principalRef.type || !principalRef.id) issues.push("Select principal type and principal ID in Step 2.");
    if (scopeActions.length === 0) issues.push("Select at least one action in Step 2.");
    if (!resourceRef.type || !resourceRef.id) issues.push("Select resource type and resource ID in Step 2.");
    if (!generatedPolicyText.trim()) issues.push("Generated Cedar policy preview is empty.");
    return issues;
  }, [name, scopePrincipalType, scopePrincipalId, scopeActions, scopeResourceType, scopeResourceId, generatedPolicyText]);

  function resetBuilderState() {
    setIntent("permit");
    setName("");
    setDescription("");
    setActivate(true);
    setScopePrincipalType(principalTypeOptions[0] ?? "User");
    setScopePrincipalId("alice");
    setScopeActions(actionOptions.length > 0 ? [actionOptions[0]] : ["Action:view"]);
    setScopeResourceType(
      scopeEntityTypeOptions.find((t) => !(t === "User" || t === "Group" || t.endsWith("::User") || t.endsWith("::Group"))) ?? "Document"
    );
    setScopeResourceId("demo-doc");
    setConditionsText("");
    setSelectedTemplateId(undefined);
    setTemplateName("");
    setTemplateDescription("");
  }

  function loadTemplate(templateId: string) {
    const template = savedTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setSelectedTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setIntent(template.intent);
    setName(template.name);
    setDescription(template.description);
    setScopePrincipalType(template.principalType);
    setScopePrincipalId(template.principalId);
    setScopeActions(template.actions.length > 0 ? template.actions : ["Action:view"]);
    setScopeResourceType(template.resourceType);
    setScopeResourceId(template.resourceId);
    setConditionsText(template.conditionsText);
    setPolicyText(template.policyText);
  }

  function saveReusableTemplate() {
    if (!templateName.trim()) {
      setError("Add a reusable template name before saving.");
      return;
    }
    const nextTemplate: ReusablePolicyTemplate = {
      id: selectedTemplateId ?? `${Date.now()}`,
      name: templateName.trim(),
      description: templateDescription.trim(),
      intent,
      principalType: scopePrincipalType,
      principalId: scopePrincipalId,
      actions: scopeActions,
      resourceType: scopeResourceType,
      resourceId: scopeResourceId,
      conditionsText,
      policyText: generatedPolicyText,
      createdAt: new Date().toISOString(),
    };
    setSavedTemplates((prev) => {
      const exists = prev.some((item) => item.id === nextTemplate.id);
      const updated = exists ? prev.map((item) => (item.id === nextTemplate.id ? nextTemplate : item)) : [nextTemplate, ...prev];
      return updated;
    });
    setNotice(`Reusable template "${nextTemplate.name}" saved.`);
    setSelectedTemplateId(nextTemplate.id);
  }

  function deleteReusableTemplate(templateId: string) {
    setSavedTemplates((prev) => prev.filter((item) => item.id !== templateId));
    if (selectedTemplateId === templateId) {
      setSelectedTemplateId(undefined);
    }
  }

  useEffect(() => {
    setPolicyText(generatedPolicyText);
  }, [generatedPolicyText]);

  useEffect(() => {
    if (principalTypeOptions.length > 0 && !principalTypeOptions.includes(scopePrincipalType)) {
      setScopePrincipalType(principalTypeOptions[0]);
    }
  }, [principalTypeOptions, scopePrincipalType]);

  useEffect(() => {
    if (actionOptions.length === 0) return;
    const validSelected = scopeActions.filter((item) => actionOptions.includes(item));
    if (validSelected.length === 0) {
      setScopeActions([actionOptions[0]]);
      return;
    }
    if (validSelected.length !== scopeActions.length) {
      setScopeActions(validSelected);
    }
  }, [actionOptions, scopeActions]);

  useEffect(() => {
    if (scopeEntityTypeOptions.length === 0) return;
    if (!scopeEntityTypeOptions.includes(scopeResourceType)) {
      const fallbackResourceType =
        scopeEntityTypeOptions.find((t) => !(t === "User" || t === "Group" || t.endsWith("::User") || t.endsWith("::Group"))) ??
        scopeEntityTypeOptions[0];
      setScopeResourceType(fallbackResourceType);
    }
  }, [scopeEntityTypeOptions, scopeResourceType]);

  async function onCreatePolicy() {
    setError("");
    setNotice("");
    setPolicyValidationWarnings([]);
    setAuthzResult(null);
    if (selectedAppId === "") {
      setError("Select an application first.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter a policy name.");
      return;
    }
    setSavingPolicy(true);
    try {
      const res = await api.createPolicy(selectedAppId, { name, description, policy_text: policyText, activate });
      if (res.status === "pending_approval") {
        setNotice("Policy saved but requires approval before activation.");
      } else if (res.status === "draft") {
        setNotice("Policy saved as draft.");
      } else {
        setNotice("Policy saved successfully!");
      }
      setPolicyValidationWarnings(res.validation?.warnings ?? []);
      resetBuilderState();
      const items = await api.listPolicies(selectedAppId);
      setPolicies(items);
      setActiveTab("view");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function onTemplateSubmit(policyName: string, policyDescription: string, policyTextContent: string, activatePolicy: boolean) {
    if (selectedAppId === "") {
      throw new Error("Select an application first.");
    }
    const res = await api.createPolicy(selectedAppId, {
      name: policyName,
      description: policyDescription,
      policy_text: policyTextContent,
      activate: activatePolicy,
    });
    if (res.status === "pending_approval") {
      setNotice("Policy saved but requires approval before activation.");
    } else if (res.status === "draft") {
      setNotice("Policy saved as draft.");
    } else {
      setNotice("Policy saved successfully!");
    }
    setPolicyValidationWarnings(res.validation?.warnings ?? []);
    const items = await api.listPolicies(selectedAppId);
    setPolicies(items);
    setActiveTab("view");
    setTemplateWizardOpen(false);
  }

  async function openPolicyModal(policy: PolicySummary) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    setPolicyModalOpen(true);
    setPolicyModalLoading(true);
    try {
      const item = await api.getPolicy(selectedAppId, policy.id);
      const mergedPolicy =
        item.active_version === 0 && policy.active_version > 0
          ? { ...item, active_version: policy.active_version }
          : item;
      setSelectedPolicy(mergedPolicy);
      setEditDescription(item.description ?? "");
      setEditPolicyText(item.latest_policy_text ?? "");
      setEditActivate(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPolicyModalLoading(false);
    }
  }

  function closePolicyModal() {
    setPolicyModalOpen(false);
    setSelectedPolicy(null);
    setPolicyModalLoading(false);
    setSavingExisting(false);
  }

  async function onApprovePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    try {
      await api.approvePolicy(selectedAppId, policy.id, policy.latest_version);
      setNotice(`Policy "${policy.name}" v${policy.latest_version} approved.`);
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onActivatePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    try {
      await api.activatePolicy(selectedAppId, policy.id, policy.latest_version);
      setNotice(`Policy "${policy.name}" v${policy.latest_version} activated.`);
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDeletePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    if (!confirm(`Are you sure you want to delete policy "${policy.name}"?`)) return;
    setError("");
    setNotice("");
    try {
      const res = await api.deletePolicy(selectedAppId, policy.id);
      if (res.status === "pending_deletion") {
        setNotice(`Deletion of policy "${policy.name}" requested. Requires approval.`);
      } else {
        setNotice(`Policy "${policy.name}" deleted.`);
      }
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onApproveDeletePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    try {
      await api.approveDeletePolicy(selectedAppId, policy.id);
      setNotice(`Deletion of policy "${policy.name}" approved.`);
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSaveExistingPolicy() {
    if (!selectedPolicy || selectedAppId === "") return;
    setError("");
    setNotice("");
    setSavingExisting(true);
    try {
      const res = await api.createPolicy(selectedAppId, {
        name: selectedPolicy.name,
        description: editDescription,
        policy_text: editPolicyText,
        activate: editActivate,
      });
      if (res.status === "pending_approval") {
        setNotice("Policy updated but requires approval before activation.");
      } else {
        setNotice("Policy updated (new version created).");
      }
      setPolicyValidationWarnings(res.validation?.warnings ?? []);
      const items = await api.listPolicies(selectedAppId);
      setPolicies(items);
      closePolicyModal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingExisting(false);
    }
  }

  function parseRef(v: string): { type: string; id: string } {
    const raw = v.trim();
    if (!raw) return { type: "", id: "" };

    // Accept full Cedar UID literal format: Type::"id"
    const cedarQuoted = raw.match(/^(.+)::"((?:\\.|[^"\\])*)"$/);
    if (cedarQuoted) {
      const [, typePart, idPart] = cedarQuoted;
      return { type: typePart.trim(), id: idPart.replace(/\\"/g, '"').replace(/\\\\/g, "\\") };
    }

    // Accept Type::id shorthand when users paste Cedar-ish values without quotes.
    // This branch only applies when there is no single-colon type:id separator.
    if (!raw.match(/(?<!:):(?!:)/)) {
      const doubleIdx = raw.lastIndexOf("::");
      if (doubleIdx > 0) {
        return { type: raw.slice(0, doubleIdx).trim(), id: raw.slice(doubleIdx + 2).trim() };
      }
    }

    // Default UI format: Type:id where type may include namespace (::) and id may include ':'
    // Split on first single ':' that is not part of '::'
    const singleSep = raw.match(/^(.+?)(?<!:):(?!:)([\s\S]+)$/);
    if (singleSep) {
      const [, typePart, idPart] = singleSep;
      return { type: typePart.trim(), id: idPart.trim() };
    }

    return { type: raw, id: "" };
  }

  function resolveBuilderRef(typeInput: string, idInput: string): { type: string; id: string } {
    const typeValue = (typeInput ?? "").trim();
    const idValue = (idInput ?? "").trim();
    if (!typeValue) return { type: "", id: "" };
    const cedarQuoted = typeValue.match(/^(.+)::"((?:\\.|[^"\\])*)"$/);
    if (cedarQuoted) {
      const [, parsedType, parsedID] = cedarQuoted;
      return { type: parsedType.trim(), id: parsedID.replace(/\\"/g, '"').replace(/\\\\/g, "\\") };
    }
    const idAsFullUID = parseRef(idValue);
    if (idAsFullUID.type && idAsFullUID.id) {
      return idAsFullUID;
    }
    if (idValue) return { type: typeValue, id: idValue };
    const parsed = parseRef(typeValue);
    if (parsed.type && parsed.id) {
      return parsed;
    }
    return { type: typeValue, id: "" };
  }

  useEffect(() => {
    if (schemaActionRefs.length === 0) return;
    if (authzAction === "Action:view" || !authzAction.includes(":")) {
      const first = schemaActionRefs[0];
      setAuthzAction(`${first.actionType}:${first.actionId}`);
    }
  }, [schemaActionRefs, authzAction]);

  function populateAuthorizationFromBuilder() {
    const firstAction = scopeActions[0] || "Action:view";
    const principalRef = resolveBuilderRef(scopePrincipalType, scopePrincipalId);
    const resourceRef = resolveBuilderRef(scopeResourceType, scopeResourceId);
    const isGroupPrincipal = principalRef.type === "Group" || principalRef.type.endsWith("::Group");
    if (isGroupPrincipal) {
      const inferredUserType =
        principalTypeOptions.find((t) => t === "User" || t.endsWith("::User")) ??
        "User";
      const inferredUserId = entityIdsByType.get(inferredUserType)?.[0] ?? "alice";
      setAuthzPrincipal(`${inferredUserType}:${inferredUserId}`);
      setNotice(`Group-based policy selected. Testing with ${inferredUserType}:${inferredUserId} because "principal in Group::..." expects a user/service principal.`);
    } else {
      setAuthzPrincipal(`${principalRef.type}:${principalRef.id}`);
    }
    setAuthzAction(firstAction);
    setAuthzResource(`${resourceRef.type}:${resourceRef.id}`);
    setAuthzResult(null);
  }

  async function onAuthorize() {
    setError("");
    setNotice("");
    if (selectedAppId === "") {
      setError("Select an application first.");
      return;
    }
    let parsedContext: Record<string, unknown> = {};
    try {
      parsedContext = authzContextJson.trim() ? (JSON.parse(authzContextJson) as Record<string, unknown>) : {};
    } catch {
      setError("Context JSON is invalid. Provide valid JSON in the test context field.");
      return;
    }
    setAuthorizing(true);
    try {
      const res = await api.authorize({
        application_id: selectedAppId,
        principal: parseRef(authzPrincipal),
        action: parseRef(authzAction),
        resource: parseRef(authzResource),
        context: parsedContext,
      });
      setAuthzResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthorizing(false);
    }
  }

  const createFlowStep = useMemo(() => {
    if (!name.trim()) return 0;
    if (!scopePrincipalType || !scopePrincipalId || scopeActions.length === 0 || !scopeResourceType || !scopeResourceId) return 1;
    if (!generatedPolicyText.trim()) return 2;
    if (!authzResult) return 4;
    return 5;
  }, [name, scopePrincipalType, scopePrincipalId, scopeActions, scopeResourceType, scopeResourceId, generatedPolicyText, authzResult]);

  const tabItems = [
    {
      key: "view",
      label: (
        <span>
          <EyeOutlined />
          View Policies
        </span>
      ),
      children: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {policies.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48 }}>
              <FileTextOutlined style={{ fontSize: 48, color: token.colorTextSecondary, opacity: 0.5 }} />
              <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                No policies yet for this application.
              </Typography.Paragraph>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setActiveTab("create")}>
                Create Your First Policy
              </Button>
            </div>
          ) : (
            <Table
              rowKey="id"
              loading={policiesLoading}
              pagination={false}
              dataSource={policies}
              onRow={(record) => ({
                onClick: () => openPolicyModal(record),
                style: { cursor: "pointer" },
              })}
              columns={[
                { title: "Name", dataIndex: "name", render: (v) => <Typography.Text strong>{v}</Typography.Text> },
                { title: "Description", dataIndex: "description", render: (v) => <Typography.Text type="secondary">{v || "—"}</Typography.Text> },
                { 
                  title: "Active", 
                  dataIndex: "active_version", 
                  width: 80, 
                  render: (v) => (v ? <Tag color="green">v{v}</Tag> : <Tag color="orange">No active</Tag>)
                },
                { 
                  title: "Latest", 
                  dataIndex: "latest_version", 
                  width: 80, 
                  render: (v) => v ? <Tag>v{v}</Tag> : "—"
                },
                {
                  title: "Status",
                  dataIndex: "latest_status",
                  width: 120,
                  render: (v: string) => {
                    const color = v === "approved" ? "green" : v === "pending_approval" ? "orange" : v === "pending_deletion" ? "red" : "blue";
                    return <Tag color={color}>{v ? v.toUpperCase().replace("_", " ") : "UNKNOWN"}</Tag>;
                  },
                },
                {
                  title: "Actions",
                  key: "actions",
                  width: 160,
                  render: (_: unknown, record: PolicySummary) => (
                    <Space size="small" onClick={(e) => e.stopPropagation()}>
                      {record.latest_status === "pending_approval" && (
                        <Button size="small" type="primary" ghost onClick={() => onApprovePolicy(record)}>
                          Approve
                        </Button>
                      )}
                      {record.latest_status === "pending_deletion" && (
                        <Button size="small" type="primary" danger onClick={() => onApproveDeletePolicy(record)}>
                          Approve Delete
                        </Button>
                      )}
                      {record.latest_status === "approved" && record.latest_version > record.active_version && (
                        <Button size="small" onClick={() => onActivatePolicy(record)}>
                          Activate
                        </Button>
                      )}
                      {record.latest_status !== "pending_deletion" && (
                        <Button size="small" danger onClick={() => onDeletePolicy(record)}>
                          Delete
                        </Button>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          )}
        </Space>
      ),
    },
    {
      key: "create",
      label: (
        <span>
          <PlusOutlined />
          Create Policy
        </span>
      ),
      children: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Guided Policy Flow"
            description="Follow the six steps to define intent, scope, conditions, preview, validate with a sample request, and save as a policy or reusable template."
          />

          <Card
            size="small"
            title="Reusable Templates"
            extra={
              <Button icon={<AppstoreOutlined />} onClick={() => setTemplateWizardOpen(true)} disabled={selectedAppId === ""}>
                Use Built-in Template Wizard
              </Button>
            }
          >
            <Space wrap style={{ width: "100%" }}>
              <Select
                allowClear
                placeholder="Load reusable template..."
                style={{ minWidth: 320 }}
                value={selectedTemplateId}
                onChange={(value) => {
                  if (!value) {
                    setSelectedTemplateId(undefined);
                    return;
                  }
                  loadTemplate(value);
                }}
                options={savedTemplates.map((item) => ({
                  value: item.id,
                  label: `${item.name}${item.description ? ` - ${item.description}` : ""}`,
                }))}
              />
              <Button onClick={resetBuilderState}>Start From Scratch</Button>
              <Popconfirm
                title="Delete selected template?"
                description="This cannot be undone."
                okText="Delete"
                okButtonProps={{ danger: true }}
                disabled={!selectedTemplateId}
                onConfirm={() => selectedTemplateId && deleteReusableTemplate(selectedTemplateId)}
              >
                <Button danger icon={<DeleteOutlined />} disabled={!selectedTemplateId}>
                  Delete Template
                </Button>
              </Popconfirm>
            </Space>
          </Card>

          <Card size="small">
            <Steps
              current={createFlowStep}
              items={[
                { title: "Intent" },
                { title: "Scope" },
                { title: "Conditions" },
                { title: "Preview" },
                { title: "Validate + Test" },
                { title: "Save" },
              ]}
            />
          </Card>

          <Card title="Step 1: Intent + Policy Identity">
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={8}>
                <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                  Intent
                </Typography.Text>
                <Radio.Group value={intent} onChange={(e) => setIntent(e.target.value)}>
                  <Space direction="vertical">
                    <Radio value="permit">Allow (`permit`)</Radio>
                    <Radio value="forbid">Forbid (`forbid`)</Radio>
                  </Space>
                </Radio.Group>
              </Col>
              <Col xs={24} lg={16}>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <div>
                    <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                      Policy Name <span style={{ color: token.colorError }}>*</span>
                    </Typography.Text>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., allow-users-view-documents" />
                  </div>
                  <div>
                    <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                      Description (optional)
                    </Typography.Text>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
                  </div>
                </Space>
              </Col>
            </Row>
          </Card>

          <Card title="Step 2: Scope (Principal, Actions, Resource)">
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={8}>
                <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                  Principal
                </Typography.Text>
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    style={{ width: 150 }}
                    value={scopePrincipalType}
                    onChange={setScopePrincipalType}
                    options={(principalTypeOptions.length > 0 ? principalTypeOptions : scopeEntityTypeOptions).map((item) => ({ value: item, label: item }))}
                  />
                  <Input
                    value={scopePrincipalId}
                    onChange={(e) => setScopePrincipalId(e.target.value)}
                    list="policy-principal-id-options"
                    placeholder="principal id"
                  />
                </Space.Compact>
                <datalist id="policy-principal-id-options">
                  {principalIdOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </Col>

              <Col xs={24} lg={8}>
                <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                  Action Set
                </Typography.Text>
                <Select
                  mode="tags"
                  value={scopeActions}
                  onChange={setScopeActions}
                  style={{ width: "100%" }}
                  placeholder="Select one or more actions"
                  options={actionOptions.map((item) => ({ value: item, label: item }))}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Format: `ActionType:actionId` (for example `Action:view`)
                </Typography.Text>
              </Col>

              <Col xs={24} lg={8}>
                <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                  Resource
                </Typography.Text>
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    style={{ width: 150 }}
                    value={scopeResourceType}
                    onChange={setScopeResourceType}
                    options={scopeEntityTypeOptions.map((item) => ({ value: item, label: item }))}
                  />
                  <Input
                    value={scopeResourceId}
                    onChange={(e) => setScopeResourceId(e.target.value)}
                    list="policy-resource-id-options"
                    placeholder="resource id"
                  />
                </Space.Compact>
                <datalist id="policy-resource-id-options">
                  {resourceIdOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Tip: you can paste a full UID in Type or ID (for example `EmailAddress::"foo@bar.com"`).
                </Typography.Text>
              </Col>
            </Row>
          </Card>

          <Card
            title="Step 3: Conditions"
            extra={
              <Tooltip title="Each non-empty line becomes one condition, combined with AND in the final when-block.">
                <Typography.Text type="secondary">How it works</Typography.Text>
              </Tooltip>
            }
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Input.TextArea
                rows={5}
                value={conditionsText}
                onChange={(e) => setConditionsText(e.target.value)}
                placeholder={`context.isBusinessHours == true\nresource.owner == principal\nprincipal.department == resource.department`}
                style={{ fontFamily: "'Fira Code', 'Monaco', monospace", fontSize: 12 }}
              />
              {normalizedSchema.contextAttributes.length > 0 && (
                <Space wrap>
                  <Typography.Text type="secondary">Schema context attributes:</Typography.Text>
                  {normalizedSchema.contextAttributes.slice(0, 10).map((attr) => (
                    <Button
                      key={attr}
                      size="small"
                      onClick={() =>
                        setConditionsText((prev) => `${prev}${prev.trim() ? "\n" : ""}context.${attr} == true`)
                      }
                    >
                      {attr}
                    </Button>
                  ))}
                </Space>
              )}
            </Space>
          </Card>

          <Card title="Step 4: Live Cedar Preview">
            <pre
              style={{
                padding: 16,
                background: token.colorBgLayout,
                borderRadius: 8,
                margin: 0,
                fontSize: 12,
                fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
                overflow: "auto",
                maxHeight: 320,
                border: `1px solid ${token.colorBorder}`,
              }}
            >
              {policyText || "// Complete steps 1-3 to generate policy text"}
            </pre>
          </Card>

          <Card title="Step 5: Validate + Test With Sample Authorization Request">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type={policies.length === 0 ? "warning" : "info"}
                showIcon
                message={
                  policies.length === 0
                    ? "No saved policies yet"
                    : "Authorization test uses saved/active backend policies"
                }
                description={
                  policies.length === 0
                    ? "This test checks persisted policies in the backend. Save and activate your policy in Step 6 first, then re-run this test."
                    : "This test does not execute the unsaved preview directly. Save/activate changes first if you expect this new policy to affect the decision."
                }
              />

              {builderValidationIssues.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Builder validation checks"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {builderValidationIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  }
                />
              ) : (
                <Alert type="success" showIcon message="Builder validation passed." />
              )}

              <Button onClick={populateAuthorizationFromBuilder}>Use Step 2 values in test request</Button>

              <Row gutter={[12, 12]}>
                <Col xs={24} lg={8}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Principal
                  </Typography.Text>
                  <Input value={authzPrincipal} onChange={(e) => setAuthzPrincipal(e.target.value)} placeholder="User:alice" />
                </Col>
                <Col xs={24} lg={8}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Action
                  </Typography.Text>
                  <Input value={authzAction} onChange={(e) => setAuthzAction(e.target.value)} placeholder="Action:view" />
                </Col>
                <Col xs={24} lg={8}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Resource
                  </Typography.Text>
                  <Input value={authzResource} onChange={(e) => setAuthzResource(e.target.value)} placeholder="Document:doc-123" />
                </Col>
              </Row>

              <div>
                <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                  Context (JSON, optional)
                </Typography.Text>
                <Input.TextArea
                  value={authzContextJson}
                  onChange={(e) => setAuthzContextJson(e.target.value)}
                  rows={3}
                  placeholder='{"isBusinessHours": true, "env": "prod"}'
                  style={{ fontFamily: "'Fira Code', 'Monaco', monospace", fontSize: 12 }}
                />
              </div>

              <Button type="primary" icon={<ThunderboltOutlined />} onClick={onAuthorize} loading={authorizing} disabled={selectedAppId === ""}>
                Run Authorization Test
              </Button>

              {authzResult && (
                <Alert
                  type={authzResult.decision === "allow" ? "success" : "error"}
                  showIcon
                  message={authzResult.decision === "allow" ? "Sample request ALLOWED" : "Sample request DENIED"}
                  description={authzResult.reasons.length > 0 ? authzResult.reasons.join(" | ") : "No reasons returned."}
                />
              )}
            </Space>
          </Card>

          <Card title="Step 6: Save Policy or Reusable Template">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Row gutter={[12, 12]}>
                <Col xs={24} lg={12}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Reusable Template Name
                  </Typography.Text>
                  <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g., support-team-read-access" />
                </Col>
                <Col xs={24} lg={12}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Reusable Template Description (optional)
                  </Typography.Text>
                  <Input value={templateDescription} onChange={(e) => setTemplateDescription(e.target.value)} placeholder="Quickly reuse this scope + conditions" />
                </Col>
              </Row>

              {selectedApp?.approval_required && (
                <Alert
                  type="info"
                  showIcon
                  message="Approval Required"
                  description="This application requires approval for policy changes. Checking the box below submits for approval."
                />
              )}

              <Checkbox checked={activate} onChange={(e) => setActivate(e.target.checked)}>
                {selectedApp?.approval_required ? "Submit for approval" : "Activate this policy immediately"}
              </Checkbox>

              <Space wrap>
                <Button onClick={saveReusableTemplate} disabled={!templateName.trim() || !policyText.trim()}>
                  Save Reusable Template
                </Button>
                <Button type="primary" onClick={onCreatePolicy} loading={savingPolicy} disabled={selectedAppId === "" || !name.trim() || !policyText.trim()}>
                  Save Policy
                </Button>
              </Space>
            </Space>
          </Card>
        </Space>
      ),
    },
    {
      key: "test",
      label: (
        <span>
          <ThunderboltOutlined />
          Test Authorization
        </span>
      ),
      children: (
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={12}>
            <Card title="Authorization Request">
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message="Test your policies"
                  description="Enter a principal, action, and resource to check if the request would be allowed or denied."
                />

                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Principal (Who is making the request?)
                  </Typography.Text>
                  <Input 
                    value={authzPrincipal} 
                    onChange={(e) => setAuthzPrincipal(e.target.value)} 
                    placeholder="Type:id (e.g., User:alice)"
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    Format: Type:id (e.g., User:alice, Group:admins)
                  </Typography.Text>
                </div>
                
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Action (What do they want to do?)
                  </Typography.Text>
                  {schemaActionRefs.length > 0 ? (
                    <Select
                      showSearch
                      allowClear
                      value={authzAction || undefined}
                      onChange={(v) => setAuthzAction(v || "")}
                      placeholder="Select schema action or enter custom..."
                      options={schemaActionRefs.map((a) => ({
                        value: `${a.actionType}:${a.actionId}`,
                        label: `${a.actionType}:${a.actionId}`,
                      }))}
                      dropdownRender={(menu) => (
                        <>
                          {menu}
                          <div style={{ padding: 8, borderTop: "1px solid #f0f0f0" }}>
                            <Input
                              size="small"
                              placeholder="Or enter custom Type:id"
                              value={authzAction}
                              onChange={(e) => setAuthzAction(e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    />
                  ) : (
                    <Input 
                      value={authzAction} 
                      onChange={(e) => setAuthzAction(e.target.value)}
                      placeholder="Type:id (e.g., Action:view or AgentGuardrails::Action:email.send)"
                    />
                  )}
                </div>
                
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Resource (On what?)
                  </Typography.Text>
                  <Input 
                    value={authzResource} 
                    onChange={(e) => setAuthzResource(e.target.value)}
                    placeholder="Document:doc-123"
                  />
                </div>
                
                <Button 
                  type="primary" 
                  onClick={onAuthorize} 
                  loading={authorizing} 
                  disabled={selectedAppId === ""}
                  icon={<ThunderboltOutlined />}
                  block
                  size="large"
                >
                  Check Authorization
                </Button>
              </Space>
            </Card>
          </Col>
          
          <Col xs={24} lg={12}>
            <Card title="Result" style={{ height: "100%" }}>
              {!authzResult ? (
                <div style={{ textAlign: "center", padding: 48, color: token.colorTextSecondary }}>
                  <ThunderboltOutlined style={{ fontSize: 48, opacity: 0.3 }} />
                  <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                    Run an authorization check to see the result here
                  </Typography.Paragraph>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      padding: 32,
                      background: authzResult.decision === "allow" ? "#f6ffed" : "#fff2f0",
                      borderRadius: 8,
                      border: `2px solid ${authzResult.decision === "allow" ? "#52c41a" : "#ff4d4f"}`,
                      marginBottom: 16,
                    }}
                  >
                    <Typography.Title 
                      level={2} 
                      style={{ margin: 0, color: authzResult.decision === "allow" ? "#52c41a" : "#ff4d4f" }}
                    >
                      {authzResult.decision === "allow" ? "✓ ALLOWED" : "✗ DENIED"}
                    </Typography.Title>
                  </div>
                  
                  {authzResult.reasons && authzResult.reasons.length > 0 && (
                    <div style={{ textAlign: "left" }}>
                      <Typography.Text strong>Reasons:</Typography.Text>
                      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                        {authzResult.reasons.map((r, i) => (
                          <li key={i}><Typography.Text code>{r}</Typography.Text></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      {/* Header */}
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Policies
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Create and manage Cedar authorization policies for your applications.
        </Typography.Paragraph>
      </div>

      {/* Alerts */}
      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />}
      {notice && <Alert type="success" showIcon message={notice} closable onClose={() => setNotice("")} />}
      {policyValidationWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setPolicyValidationWarnings([])}
          message="Schema validation warnings"
          description={policyValidationWarnings.join(" ")}
        />
      )}

      {/* Application Selector */}
      <Card size="small">
        <Space style={{ width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}>
          <Space>
            <Typography.Text strong>Application:</Typography.Text>
            <Select
              value={selectedAppId === "" ? undefined : selectedAppId}
              onChange={(v) => setSelectedAppId(v)}
              placeholder="Select an application..."
              style={{ minWidth: 250 }}
              loading={loading}
              showSearch
              optionFilterProp="label"
              options={apps.map((a) => ({ 
                value: a.id, 
                label: `${a.name} (${a.namespace_name})` 
              }))}
            />
          </Space>
          {selectedApp && (
            <Tag color="blue">{policies.length} {policies.length === 1 ? 'policy' : 'policies'}</Tag>
          )}
        </Space>
      </Card>

      {/* Main Content Tabs */}
      {selectedAppId !== "" ? (
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab} 
          items={tabItems}
          type="card"
        />
      ) : (
        <Card>
          <div style={{ textAlign: "center", padding: 48 }}>
            <Typography.Paragraph type="secondary">
              Select an application above to manage its policies.
            </Typography.Paragraph>
          </div>
        </Card>
      )}

      {/* Policy Edit Modal */}
      <Modal
        open={policyModalOpen}
        title={selectedPolicy ? `Edit Policy: ${selectedPolicy.name}` : "Policy"}
        onCancel={closePolicyModal}
        width={700}
        footer={
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Button
              icon={<ExperimentOutlined />}
              onClick={() => {
                console.log('[Policies] Simulate Impact clicked, opening simulator');
                setSimulatorOpen(true);
              }}
              disabled={!selectedPolicy || !editPolicyText.trim()}
            >
              Simulate Impact
            </Button>
            <Space>
              <Button onClick={closePolicyModal}>Cancel</Button>
              <Button
                onClick={() => setEditPolicyText(selectedPolicy?.active_policy_text || "")}
                disabled={!selectedPolicy?.active_policy_text}
              >
                Load Active Version
              </Button>
              <Button
                type="primary"
                onClick={onSaveExistingPolicy}
                loading={savingExisting}
                disabled={!selectedPolicy || !editPolicyText.trim()}
              >
                Save New Version
              </Button>
            </Space>
          </Space>
        }
      >
        {policyModalLoading ? (
          <Typography.Paragraph style={{ margin: 0 }}>Loading policy…</Typography.Paragraph>
        ) : !selectedPolicy ? (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            No policy selected.
          </Typography.Paragraph>
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space>
              {selectedPolicy.active_version > 0 ? (
                <Tag color="green">Active: v{selectedPolicy.active_version}</Tag>
              ) : (
                <Tag color="orange">No active version</Tag>
              )}
              <Tag>Latest: v{selectedPolicy.latest_version || "—"}</Tag>
            </Space>

            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Name</Typography.Text>
              <Input value={selectedPolicy.name} readOnly disabled />
            </div>
            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Description</Typography.Text>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Policy Text</Typography.Text>
              <Input.TextArea 
                value={editPolicyText} 
                onChange={(e) => setEditPolicyText(e.target.value)} 
                rows={12}
                style={{ fontFamily: "'Fira Code', 'Monaco', monospace", fontSize: 12 }}
              />
            </div>
            {selectedApp?.approval_required && (
              <Alert
                type="info"
                showIcon
                message="Approval Required"
                description="This application requires approval for policy changes."
                style={{ marginBottom: 12 }}
              />
            )}
            <Checkbox checked={editActivate} onChange={(e) => setEditActivate(e.target.checked)}>
              {selectedApp?.approval_required ? "Submit for approval" : "Activate this version immediately"}
            </Checkbox>
          </Space>
        )}
      </Modal>

      {/* Policy Template Wizard */}
      <PolicyTemplateWizard
        open={templateWizardOpen}
        onClose={() => setTemplateWizardOpen(false)}
        onSubmit={onTemplateSubmit}
        saving={savingPolicy}
        approvalRequired={selectedApp?.approval_required}
        entityTypes={entityTypes}
        actions={schemaActions}
        actionRefs={schemaActionRefs}
      />

      {/* Policy Simulator */}
      {selectedPolicy && selectedAppId !== "" && (
        <PolicySimulator
          appId={selectedAppId}
          policyId={selectedPolicy.id}
          policyName={selectedPolicy.name}
          currentPolicyText={selectedPolicy.active_policy_text || selectedPolicy.latest_policy_text || ""}
          newPolicyText={editPolicyText}
          visible={simulatorOpen}
          onClose={() => setSimulatorOpen(false)}
        />
      )}
    </Space>
  );
}
