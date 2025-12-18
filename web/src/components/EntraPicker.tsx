import { useState, useEffect, useCallback, useRef } from "react";
import { Select, Space, Tag, Spin, Alert, Typography, Tabs, Avatar, Tooltip } from "antd";
import { UserOutlined, TeamOutlined, SearchOutlined } from "@ant-design/icons";
import { api, EntraUser, EntraGroup, EntraStatus } from "../api";

// Simple debounce implementation to avoid lodash dependency
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

const { Text } = Typography;

export type EntraSelection = {
  type: "User" | "Group";
  id: string;
  displayName: string;
  detail?: string; // email or description
};

type EntraPickerProps = {
  value?: EntraSelection[];
  onChange?: (selections: EntraSelection[]) => void;
  mode?: "multiple" | "single";
  placeholder?: string;
  disabled?: boolean;
  allowedTypes?: ("User" | "Group")[];
};

export function EntraPicker({
  value = [],
  onChange,
  mode = "multiple",
  placeholder = "Search for users or groups...",
  disabled = false,
  allowedTypes = ["User", "Group"],
}: EntraPickerProps) {
  const [entraStatus, setEntraStatus] = useState<EntraStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<EntraUser[]>([]);
  const [groups, setGroups] = useState<EntraGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"User" | "Group">(
    allowedTypes.includes("User") ? "User" : "Group"
  );

  // Check Entra configuration status
  useEffect(() => {
    api.entra.getStatus().then(setEntraStatus).catch(console.error);
  }, []);

  // Debounced search function
  const performSearch = useCallback(
    debounce(async (query: string, type: "User" | "Group") => {
      if (!query || query.length < 2) {
        if (type === "User") setUsers([]);
        else setGroups([]);
        return;
      }

      setLoading(true);
      try {
        if (type === "User") {
          const result = await api.entra.searchUsers(query, 15);
          setUsers(result.users || []);
        } else {
          const result = await api.entra.searchGroups(query, 15);
          setGroups(result.groups || []);
        }
      } catch (err) {
        console.error("Entra search failed:", err);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  // Trigger search when query or tab changes
  useEffect(() => {
    performSearch(searchQuery, activeTab);
  }, [searchQuery, activeTab, performSearch]);

  const handleSelect = (selectedValue: string, option: any) => {
    console.log("EntraPicker handleSelect:", selectedValue);
    // Parse the selected value (format: "type::id::displayName::detail")
    const parts = selectedValue.split("::");
    if (parts.length < 3) {
      console.error("Invalid selection format:", selectedValue);
      return;
    }
    const [type, id, displayName, detail] = parts;
    
    const newSelection: EntraSelection = {
      type: type as "User" | "Group",
      id,
      displayName,
      detail: detail || "",
    };

    if (mode === "single") {
      onChange?.([newSelection]);
    } else {
      // Check if already selected
      const exists = value.some((v) => v.type === type && v.id === id);
      if (!exists) {
        onChange?.([...value, newSelection]);
      }
    }
    
    // Clear search
    setSearchQuery("");
    setUsers([]);
    setGroups([]);
  };

  const handleDeselect = (deselectedValue: string) => {
    const [type, id] = deselectedValue.split("::");
    onChange?.(value.filter((v) => !(v.type === type && v.id === id)));
  };

  const handleClear = () => {
    onChange?.([]);
    setSearchQuery("");
  };

  if (!entraStatus?.configured) {
    return (
      <Alert
        type="info"
        showIcon
        message="Entra ID not configured"
        description="Microsoft Entra ID integration is not configured. You can manually enter user and group identifiers in the policy text."
      />
    );
  }

  const userOptions = users.map((u) => ({
    value: `User::${u.id}::${u.displayName}::${u.mail || u.userPrincipalName}`,
    label: (
      <Space>
        <Avatar size="small" icon={<UserOutlined />} />
        <div>
          <div>{u.displayName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {u.mail || u.userPrincipalName}
          </Text>
        </div>
      </Space>
    ),
  }));

  const groupOptions = groups.map((g) => ({
    value: `Group::${g.id}::${g.displayName}::${g.description || ""}`,
    label: (
      <Space>
        <Avatar size="small" icon={<TeamOutlined />} style={{ backgroundColor: "#1890ff" }} />
        <div>
          <div>{g.displayName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {g.description || g.mail || "Security Group"}
          </Text>
        </div>
      </Space>
    ),
  }));

  const options = activeTab === "User" ? userOptions : groupOptions;

  const selectedValues = value.map(
    (v) => `${v.type}::${v.id}::${v.displayName}::${v.detail || ""}`
  );

  return (
    <div>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as "User" | "Group")}
        size="small"
        style={{ marginBottom: 8 }}
        items={[
          ...(allowedTypes.includes("User")
            ? [
                {
                  key: "User",
                  label: (
                    <span>
                      <UserOutlined /> Users
                    </span>
                  ),
                },
              ]
            : []),
          ...(allowedTypes.includes("Group")
            ? [
                {
                  key: "Group",
                  label: (
                    <span>
                      <TeamOutlined /> Groups
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Select
        mode={mode === "multiple" ? "multiple" : undefined}
        style={{ width: "100%" }}
        placeholder={placeholder}
        disabled={disabled}
        showSearch
        filterOption={false}
        searchValue={searchQuery}
        onSearch={setSearchQuery}
        onSelect={handleSelect}
        onDeselect={handleDeselect}
        onClear={handleClear}
        value={mode === "multiple" ? selectedValues : (selectedValues.length > 0 ? selectedValues[0] : undefined)}
        notFoundContent={
          loading ? (
            <Spin size="small" />
          ) : searchQuery.length < 2 ? (
            <Text type="secondary">Type at least 2 characters to search</Text>
          ) : (
            <Text type="secondary">No results found</Text>
          )
        }
        options={options}
        suffixIcon={<SearchOutlined />}
        allowClear
        tagRender={({ value: tagValue, closable, onClose }) => {
          const [type, , displayName] = (tagValue as string).split("::");
          return (
            <Tag
              closable={closable}
              onClose={onClose}
              icon={type === "User" ? <UserOutlined /> : <TeamOutlined />}
              color={type === "User" ? "blue" : "green"}
            >
              {displayName}
            </Tag>
          );
        }}
      />

      {value.length > 0 && mode === "multiple" && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Selected ({value.length}):
          </Text>
          <div style={{ marginTop: 4 }}>
            {value.map((v) => (
              <Tooltip key={`${v.type}-${v.id}`} title={v.detail}>
                <Tag
                  icon={v.type === "User" ? <UserOutlined /> : <TeamOutlined />}
                  color={v.type === "User" ? "blue" : "green"}
                  closable
                  onClose={() => handleDeselect(`${v.type}::${v.id}::${v.displayName}::${v.detail}`)}
                >
                  {v.displayName}
                </Tag>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Helper function to generate Cedar policy principal clause from Entra selections.
 */
export function generatePrincipalClause(selections: EntraSelection[]): string {
  if (selections.length === 0) {
    return "principal";
  }

  if (selections.length === 1) {
    const s = selections[0];
    return `principal == ${s.type}::"${s.id}"`;
  }

  // Multiple selections - use 'in' with a set
  const principals = selections.map((s) => `${s.type}::"${s.id}"`).join(", ");
  return `principal in [${principals}]`;
}

/**
 * Helper to insert user/group into policy text at cursor position.
 */
export function insertPrincipalIntoPolicy(
  policyText: string,
  selection: EntraSelection,
  cursorPosition?: number
): string {
  const principalRef = `${selection.type}::"${selection.id}"`;
  
  if (cursorPosition !== undefined) {
    return (
      policyText.slice(0, cursorPosition) +
      principalRef +
      policyText.slice(cursorPosition)
    );
  }
  
  // If no cursor position, try to find and replace 'principal' keyword
  return policyText.replace(
    /\bprincipal\b(?!\s*==|\s*in\b)/,
    `principal == ${principalRef}`
  );
}

export default EntraPicker;

