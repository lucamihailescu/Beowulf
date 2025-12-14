import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Modal, Select, Space, Table, Typography } from "antd";
import { API_BASE_URL, api, type Application, type AuthorizeResponse, type CedarEntity, type PolicyDetails, type PolicySummary } from "../api";

const DEFAULT_POLICY = `permit (
  principal == User::"alice",
  action == Action::"view",
  resource == Document::"demo-doc"
);`;

export default function Policies() {
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
  const [entitiesLoading, setEntitiesLoading] = useState(false);

  const [selectedAppId, setSelectedAppId] = useState<number | "">("");
  const [name, setName] = useState("allow-view");
  const [description, setDescription] = useState("Demo allow view");
  const [policyText, setPolicyText] = useState(DEFAULT_POLICY);
  const [activate, setActivate] = useState(true);

  const [effect, setEffect] = useState<"permit" | "forbid">("permit");
  const [wizPrincipalType, setWizPrincipalType] = useState("User");
  const [wizPrincipalId, setWizPrincipalId] = useState("alice");
  const [wizActionType, setWizActionType] = useState("Action");
  const [wizActionId, setWizActionId] = useState("view");
  const [wizResourceType, setWizResourceType] = useState("Document");
  const [wizResourceId, setWizResourceId] = useState("demo-doc");

  const [authzPrincipal, setAuthzPrincipal] = useState("User:alice");
  const [authzAction, setAuthzAction] = useState("Action:view");
  const [authzResource, setAuthzResource] = useState("Document:demo-doc");
  const [authzResult, setAuthzResult] = useState<AuthorizeResponse | null>(null);

  const selectedApp = useMemo(() => apps.find((a) => a.id === selectedAppId), [apps, selectedAppId]);

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
    if (selectedAppId === "" && apps.length > 0) {
      setSelectedAppId(apps[0].id);
    }
  }, [apps, selectedAppId]);

  useEffect(() => {
    if (selectedAppId === "") {
      setPolicies([]);
      return;
    }

    (async () => {
      setPoliciesLoading(true);
      try {
        const items = await api.listPolicies(selectedAppId);
        setPolicies(items);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setPoliciesLoading(false);
      }
    })();
  }, [selectedAppId]);

  useEffect(() => {
    if (selectedAppId === "") {
      setEntities([]);
      return;
    }

    (async () => {
      setEntitiesLoading(true);
      try {
        const items = await api.listEntities(selectedAppId);
        setEntities(items);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setEntitiesLoading(false);
      }
    })();
  }, [selectedAppId]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of entities) {
      if (e?.uid?.type) set.add(e.uid.type);
    }
    return Array.from(set).sort();
  }, [entities]);

  const entityIdsByType = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of entities) {
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

  function escapeCedarString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
  }

  function buildPolicyText(): string {
    const pType = wizPrincipalType.trim();
    const pId = wizPrincipalId.trim();
    const aType = wizActionType.trim();
    const aId = wizActionId.trim();
    const rType = wizResourceType.trim();
    const rId = wizResourceId.trim();

    return `${effect} (\n  principal == ${pType}::\"${escapeCedarString(pId)}\",\n  action == ${aType}::\"${escapeCedarString(aId)}\",\n  resource == ${rType}::\"${escapeCedarString(rId)}\"\n);`;
  }

  function applyWizardToTextarea() {
    setPolicyText(buildPolicyText());
  }

  async function onCreatePolicy() {
    setError("");
    setNotice("");
    setAuthzResult(null);
    if (selectedAppId === "") {
      setError("Select an application first.");
      return;
    }
    setSavingPolicy(true);
    try {
      await api.createPolicy(selectedAppId, { name, description, policy_text: policyText, activate });
      setNotice("Policy saved.");

		const items = await api.listPolicies(selectedAppId);
		setPolicies(items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function openPolicyModal(policyId: number) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    setPolicyModalOpen(true);
    setPolicyModalLoading(true);
    try {
      const item = await api.getPolicy(selectedAppId, policyId);
      setSelectedPolicy(item);
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

  async function onSaveExistingPolicy() {
    if (!selectedPolicy || selectedAppId === "") return;
    setError("");
    setNotice("");
    setSavingExisting(true);
    try {
      await api.createPolicy(selectedAppId, {
        name: selectedPolicy.name,
        description: editDescription,
        policy_text: editPolicyText,
        activate: editActivate,
      });
      setNotice("Policy updated (new version created).");
      const items = await api.listPolicies(selectedAppId);
      setPolicies(items);
      const refreshed = await api.getPolicy(selectedAppId, selectedPolicy.id);
      setSelectedPolicy(refreshed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingExisting(false);
    }
  }

  function parseRef(v: string): { type: string; id: string } {
    const [type, id] = v.split(":");
    return { type: type ?? "", id: id ?? "" };
  }

  async function onAuthorize() {
    setError("");
    setNotice("");
    if (selectedAppId === "") {
      setError("Select an application first.");
      return;
    }
    setAuthorizing(true);
    try {
      const res = await api.authorize({
        application_id: selectedAppId,
        principal: parseRef(authzPrincipal),
        action: parseRef(authzAction),
        resource: parseRef(authzResource),
        context: {},
      });
      setAuthzResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthorizing(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Policies
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Create policy versions and (optionally) activate them for an application.
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          API: <Typography.Text code>{API_BASE_URL}</Typography.Text>
        </Typography.Text>
      </div>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {notice ? <Alert type="success" showIcon message={notice} /> : null}

      <Card title="Application" loading={loading}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <div>
            <Typography.Text>Selected application</Typography.Text>
            <Select
              value={selectedAppId === "" ? undefined : selectedAppId}
              onChange={(v) => setSelectedAppId(v)}
              placeholder="Select…"
              style={{ width: "100%" }}
              showSearch
              optionFilterProp="label"
              options={apps.map((a) => ({ value: a.id, label: `${a.name} (id=${a.id})` }))}
            />
          </div>
          {selectedApp ? (
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              Selected: {selectedApp.name}
            </Typography.Paragraph>
          ) : null}
        </Space>
      </Card>

      <Card title="Existing policies" loading={loading}>
        {selectedAppId === "" ? (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            Select an application to view its policies.
          </Typography.Paragraph>
        ) : (
          <Table
            rowKey="id"
            loading={policiesLoading}
            pagination={false}
            dataSource={policies}
            onRow={(record) => ({
              onClick: () => openPolicyModal(record.id),
              style: { cursor: "pointer" },
            })}
            columns={[
              { title: "Name", dataIndex: "name" },
              { title: "Description", dataIndex: "description", render: (v) => <Typography.Text type="secondary">{v}</Typography.Text> },
              { title: "Active", dataIndex: "active_version", width: 120, render: (v) => v || "—" },
              { title: "Latest", dataIndex: "latest_version", width: 120, render: (v) => v || "—" },
            ]}
            locale={{ emptyText: "No policies yet for this application." }}
          />
        )}
      </Card>

      <Modal
        open={policyModalOpen}
        title={selectedPolicy ? `Policy: ${selectedPolicy.name}` : "Policy"}
        onCancel={closePolicyModal}
        footer={
          <Space>
            <Button onClick={closePolicyModal}>Close</Button>
            <Button
              onClick={() => setEditPolicyText(selectedPolicy?.active_policy_text || "")}
              disabled={!selectedPolicy?.active_policy_text}
            >
              Load active text
            </Button>
            <Button
              type="primary"
              onClick={onSaveExistingPolicy}
              loading={savingExisting}
              disabled={!selectedPolicy || !editPolicyText.trim()}
            >
              Save new version
            </Button>
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
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              Active v{selectedPolicy.active_version || "—"} · Latest v{selectedPolicy.latest_version || "—"}
            </Typography.Paragraph>

            <div>
              <Typography.Text>Name</Typography.Text>
              <Input value={selectedPolicy.name} readOnly />
            </div>
            <div>
              <Typography.Text>Description</Typography.Text>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
            <div>
              <Typography.Text>Latest policy text (editable)</Typography.Text>
              <Input.TextArea value={editPolicyText} onChange={(e) => setEditPolicyText(e.target.value)} rows={12} />
            </div>
            <Checkbox checked={editActivate} onChange={(e) => setEditActivate(e.target.checked)}>
              Activate new version
            </Checkbox>
          </Space>
        )}
      </Modal>

      <Card title="Create policy" loading={loading}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Card type="inner" title="Policy builder">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Select principal/action/resource and generate a Cedar policy. You can still edit the text below.
              </Typography.Paragraph>

              {selectedAppId !== "" && entitiesLoading ? (
                <Typography.Paragraph style={{ margin: 0 }}>Loading entities…</Typography.Paragraph>
              ) : null}

              <div>
                <Typography.Text>Effect</Typography.Text>
                <Select
                  value={effect}
                  onChange={(v) => setEffect(v === "forbid" ? "forbid" : "permit")}
                  style={{ width: "100%" }}
                  options={[
                    { value: "permit", label: "permit" },
                    { value: "forbid", label: "forbid" },
                  ]}
                />
              </div>

              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Typography.Text strong>Principal</Typography.Text>
                <Select
                  value={wizPrincipalType}
                  onChange={(t) => {
                    setWizPrincipalType(t);
                    const ids = entityIdsByType.get(t);
                    if (ids && ids.length > 0) setWizPrincipalId(ids[0]);
                  }}
                  style={{ width: "100%" }}
                  options={(entityTypes.length ? entityTypes : ["User"]).map((t) => ({ value: t, label: t }))}
                />
                <Select
                  value={wizPrincipalId}
                  onChange={(v) => setWizPrincipalId(v)}
                  style={{ width: "100%" }}
                  placeholder="Select id"
                  options={(entityIdsByType.get(wizPrincipalType) ?? []).map((id) => ({ value: id, label: id }))}
                />
                <Input value={wizPrincipalId} onChange={(e) => setWizPrincipalId(e.target.value)} placeholder="alice" />
              </Space>

              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Typography.Text strong>Action</Typography.Text>
                <Select
                  value={wizActionType}
                  onChange={(t) => {
                    setWizActionType(t);
                    const ids = entityIdsByType.get(t);
                    if (ids && ids.length > 0) setWizActionId(ids[0]);
                  }}
                  style={{ width: "100%" }}
                  options={(entityTypes.length ? entityTypes : ["Action"]).map((t) => ({ value: t, label: t }))}
                />
                <Select
                  value={wizActionId}
                  onChange={(v) => setWizActionId(v)}
                  style={{ width: "100%" }}
                  placeholder="Select id"
                  options={(entityIdsByType.get(wizActionType) ?? []).map((id) => ({ value: id, label: id }))}
                />
                <Input value={wizActionId} onChange={(e) => setWizActionId(e.target.value)} placeholder="view" />
              </Space>

              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Typography.Text strong>Resource</Typography.Text>
                <Select
                  value={wizResourceType}
                  onChange={(t) => {
                    setWizResourceType(t);
                    const ids = entityIdsByType.get(t);
                    if (ids && ids.length > 0) setWizResourceId(ids[0]);
                  }}
                  style={{ width: "100%" }}
                  options={(entityTypes.length ? entityTypes : ["Document"]).map((t) => ({ value: t, label: t }))}
                />
                <Select
                  value={wizResourceId}
                  onChange={(v) => setWizResourceId(v)}
                  style={{ width: "100%" }}
                  placeholder="Select id"
                  options={(entityIdsByType.get(wizResourceType) ?? []).map((id) => ({ value: id, label: id }))}
                />
                <Input value={wizResourceId} onChange={(e) => setWizResourceId(e.target.value)} placeholder="demo-doc" />
              </Space>

              <div>
                <Typography.Text>Preview</Typography.Text>
                <pre>{buildPolicyText()}</pre>
              </div>

              <Button
                onClick={applyWizardToTextarea}
                disabled={!wizPrincipalType || !wizPrincipalId || !wizActionType || !wizActionId || !wizResourceType || !wizResourceId}
              >
                Use this in policy text
              </Button>
            </Space>
          </Card>

          <div>
            <Typography.Text>Name</Typography.Text>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Typography.Text>Description</Typography.Text>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Typography.Text>Policy text</Typography.Text>
            <Input.TextArea value={policyText} onChange={(e) => setPolicyText(e.target.value)} rows={9} />
          </div>

          <Checkbox checked={activate} onChange={(e) => setActivate(e.target.checked)}>
            Activate this version
          </Checkbox>

          <Button type="primary" onClick={onCreatePolicy} loading={savingPolicy} disabled={selectedAppId === "" || !name || !policyText}>
            Save
          </Button>

          {selectedApp ? (
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              Selected: {selectedApp.name}
            </Typography.Paragraph>
          ) : null}
        </Space>
      </Card>

      <Card title="Authorize sandbox" loading={loading}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            Format: <Typography.Text code>Type:id</Typography.Text> (e.g. <Typography.Text code>User:alice</Typography.Text>)
          </Typography.Paragraph>

          <div>
            <Typography.Text>Principal</Typography.Text>
            <Input value={authzPrincipal} onChange={(e) => setAuthzPrincipal(e.target.value)} />
          </div>
          <div>
            <Typography.Text>Action</Typography.Text>
            <Input value={authzAction} onChange={(e) => setAuthzAction(e.target.value)} />
          </div>
          <div>
            <Typography.Text>Resource</Typography.Text>
            <Input value={authzResource} onChange={(e) => setAuthzResource(e.target.value)} />
          </div>
          <Button type="primary" onClick={onAuthorize} loading={authorizing} disabled={selectedAppId === ""}>
            Authorize
          </Button>

          {authzResult ? <pre>{JSON.stringify(authzResult, null, 2)}</pre> : <Typography.Text type="secondary">No result yet.</Typography.Text>}
        </Space>
      </Card>
    </Space>
  );
}
